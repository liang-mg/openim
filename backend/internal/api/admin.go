package api

// 员工与权限管理：由管理员维护部门、岗位、角色与直属上级。
// 账号本身仍归 IM 管（这里只读 IM 的 user/attribute 集合挑人），
// OA 只保存"组织关系"这一层，避免两套账号体系打架。

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/xinbo/xinbo-oa/internal/auth"
	"github.com/xinbo/xinbo-oa/internal/model"
)

var validRoles = map[string]bool{"employee": true, "manager": true, "leader": true}

// isAdmin 当前登录人是否能维护人员。
// is_admin 标记与历史 hr/admin 角色都算，保证老数据可用。
func (s *Server) isAdmin(ctx context.Context, uid string) bool {
	if e := s.getEmployee(ctx, uid); e != nil && !e.Disabled {
		return e.IsAdmin || e.Role == "hr" || e.Role == "admin"
	}
	return false
}

// phoneMap 一次性取 IM 手机号，避免逐条查库。
func (s *Server) phoneMap(ctx context.Context) map[string]string {
	out := map[string]string{}
	cur, err := s.Store.IMAttributes().Find(ctx, bson.M{})
	if err != nil {
		return out
	}
	var rows []struct {
		UserID      string `bson:"user_id"`
		PhoneNumber string `bson:"phone_number"`
	}
	if err = cur.All(ctx, &rows); err != nil {
		return out
	}
	for _, r := range rows {
		if r.PhoneNumber != "" {
			out[r.UserID] = r.PhoneNumber
		}
	}
	return out
}

// EmployeeList 管理页列表：支持关键字、部门、角色、是否含停用筛选。
func (s *Server) EmployeeList(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
	defer cancel()

	if !s.isAdmin(ctx, auth.UserID(c)) {
		fail(c, "无权管理员工")
		return
	}

	filter := bson.M{"company_id": s.Cfg.CompanyID}
	if kw := strings.TrimSpace(c.Query("keyword")); kw != "" {
		filter["$or"] = bson.A{
			bson.M{"real_name": bson.M{"$regex": kw, "$options": "i"}},
			bson.M{"department": bson.M{"$regex": kw, "$options": "i"}},
			bson.M{"position": bson.M{"$regex": kw, "$options": "i"}},
		}
	}
	if dept := strings.TrimSpace(c.Query("department")); dept != "" {
		filter["department"] = dept
	}
	if role := strings.TrimSpace(c.Query("role")); role != "" {
		filter["role"] = role
	}
	if c.Query("include_disabled") != "1" {
		filter["disabled"] = bson.M{"$ne": true}
	}

	cur, err := s.Store.Employees().Find(ctx, filter, options.Find().SetSort(bson.D{
		{Key: "disabled", Value: 1}, {Key: "department", Value: 1}, {Key: "real_name", Value: 1},
	}))
	if err != nil {
		fail(c, "查询失败")
		return
	}
	var list []model.Employee
	if err = cur.All(ctx, &list); err != nil {
		fail(c, "查询失败")
		return
	}

	// 按管理层级排：领导 → 组长 → 员工，同层级按姓名。
	// 直接按 role 字符串排会变成 employee/leader/manager 的字母序，看着很乱。
	rank := map[string]int{"leader": 0, "manager": 1, "employee": 2}
	sort.SliceStable(list, func(i, j int) bool {
		ri, okI := rank[list[i].Role]
		if !okI {
			ri = 3
		}
		rj, okJ := rank[list[j].Role]
		if !okJ {
			rj = 3
		}
		if ri != rj {
			return ri < rj
		}
		if list[i].Disabled != list[j].Disabled {
			return !list[i].Disabled
		}
		return list[i].RealName < list[j].RealName
	})

	phones := s.phoneMap(ctx)
	views := make([]model.EmployeeView, 0, len(list))
	depts := map[string]bool{}
	for _, e := range list {
		views = append(views, model.EmployeeView{Employee: e, PhoneNumber: phones[e.UserID]})
		if e.Department != "" {
			depts[e.Department] = true
		}
	}
	deptList := make([]string, 0, len(depts))
	for d := range depts {
		deptList = append(deptList, d)
	}
	sort.Strings(deptList)

	ok(c, gin.H{"total": len(views), "list": views, "departments": deptList})
}

// IMUserCandidates 可添加为员工的 IM 账号（默认只返回还没有 OA 档案的）。
func (s *Server) IMUserCandidates(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
	defer cancel()

	if !s.isAdmin(ctx, auth.UserID(c)) {
		fail(c, "无权管理员工")
		return
	}

	// 已有档案的 user_id
	taken := map[string]bool{}
	cur, err := s.Store.Employees().Find(ctx, bson.M{"company_id": s.Cfg.CompanyID}, options.Find().SetProjection(bson.M{"user_id": 1}))
	if err == nil {
		var rows []struct {
			UserID string `bson:"user_id"`
		}
		if cur.All(ctx, &rows) == nil {
			for _, r := range rows {
				taken[r.UserID] = true
			}
		}
	}

	ucur, err := s.Store.IMUsers().Find(ctx, bson.M{}, options.Find().SetLimit(500))
	if err != nil {
		fail(c, "读取 IM 账号失败")
		return
	}
	var users []struct {
		UserID   string `bson:"user_id"`
		Nickname string `bson:"nickname"`
	}
	if err = ucur.All(ctx, &users); err != nil {
		fail(c, "读取 IM 账号失败")
		return
	}

	phones := s.phoneMap(ctx)
	kw := strings.ToLower(strings.TrimSpace(c.Query("keyword")))
	out := make([]model.IMUserOption, 0, len(users))
	for _, u := range users {
		if u.UserID == "" || u.UserID == "imAdmin" {
			continue
		}
		item := model.IMUserOption{
			UserID:      u.UserID,
			Nickname:    u.Nickname,
			PhoneNumber: phones[u.UserID],
			HasProfile:  taken[u.UserID],
		}
		if kw != "" &&
			!strings.Contains(strings.ToLower(u.Nickname), kw) &&
			!strings.Contains(u.UserID, kw) &&
			!strings.Contains(item.PhoneNumber, kw) {
			continue
		}
		out = append(out, item)
	}
	ok(c, out)
}

// saveEmployeeReq 新增与编辑共用一个入口，靠 user_id 是否已存在区分。
type saveEmployeeReq struct {
	UserID     string `json:"user_id"`
	RealName   string `json:"real_name"`
	Department string `json:"department"`
	DepartmentID *string `json:"department_id"`
	Position   string `json:"position"`
	Role       string `json:"role"`
	ManagerID  string `json:"manager_id"`
	IsAdmin    bool   `json:"is_admin"`
}

// managerLoop 判断把 managerID 设为 uid 的上级后会不会形成环。
// 沿上级链往上走，走回自己就是环（A→B→A），最多走 50 层兜底异常数据。
func (s *Server) managerLoop(ctx context.Context, uid, managerID string) bool {
	seen := map[string]bool{}
	cur := managerID
	for i := 0; i < 50 && cur != ""; i++ {
		if cur == uid {
			return true
		}
		if seen[cur] {
			return true
		}
		seen[cur] = true
		e := s.getEmployee(ctx, cur)
		if e == nil {
			return false
		}
		cur = e.ManagerID
	}
	return false
}

// SaveEmployee 新增或更新员工档案。
func (s *Server) SaveEmployee(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
	defer cancel()

	operator := auth.UserID(c)
	if !s.isAdmin(ctx, operator) {
		fail(c, "无权管理员工")
		return
	}

	var req saveEmployeeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, "参数错误")
		return
	}
	req.UserID = strings.TrimSpace(req.UserID)
	req.RealName = strings.TrimSpace(req.RealName)
	req.Department = strings.TrimSpace(req.Department)
	req.Position = strings.TrimSpace(req.Position)
	req.ManagerID = strings.TrimSpace(req.ManagerID)

	if req.UserID == "" {
		fail(c, "请选择 IM 账号")
		return
	}
	if req.RealName == "" {
		fail(c, "姓名不能为空")
		return
	}
	if !validRoles[req.Role] {
		fail(c, "角色取值不合法")
		return
	}
	if req.ManagerID == req.UserID {
		fail(c, "直属上级不能是自己")
		return
	}
	if req.ManagerID != "" {
		mgr := s.getEmployee(ctx, req.ManagerID)
		if mgr == nil {
			fail(c, "直属上级不存在")
			return
		}
		if mgr.Disabled {
			fail(c, "直属上级已停用，请先启用或换一个人")
			return
		}
		if s.managerLoop(ctx, req.UserID, req.ManagerID) {
			fail(c, "直属关系会形成环，请检查上级链")
			return
		}
	}

	existing := s.getEmployee(ctx, req.UserID)
	set := bson.M{
		"real_name":  req.RealName,
		"position":   req.Position,
		"role":       req.Role,
		"manager_id": req.ManagerID,
		"is_admin":   req.IsAdmin,
	}
	filter := bson.M{"company_id": s.Cfg.CompanyID, "user_id": req.UserID}
	if req.DepartmentID != nil {
		departmentID := strings.TrimSpace(*req.DepartmentID)
		set["department_id"] = departmentID
		if departmentID != "" {
			department, err := s.departmentByID(ctx, departmentID)
			if err != nil {
				fail(c, "目标部门不存在")
				return
			}
			set["department"] = department.Name
		} else {
			set["department"] = req.Department
		}
	} else if existing == nil || existing.DepartmentID == "" {
		set["department"] = req.Department
		filter["department_id"] = unlinkedDepartmentFilter()
	}
	if value, updating := set["department"]; updating && value == "" {
		fail(c, "请选择部门或填写旧部门名称")
		return
	}
	if existing != nil && existing.UserID == operator &&
		(existing.IsAdmin && !req.IsAdmin || existing.Role != req.Role) {
		// 允许改自己，但不能把自己降权到看不见这个页面，避免把最后一个管理员锁死
		if existing.IsAdmin && !req.IsAdmin {
			if n, _ := s.Store.Employees().CountDocuments(ctx, bson.M{
				"company_id": s.Cfg.CompanyID, "is_admin": true, "disabled": bson.M{"$ne": true},
				"user_id": bson.M{"$ne": req.UserID},
			}); n == 0 {
				fail(c, "至少保留一个管理员，不能取消自己的管理员权限")
				return
			}
		}
	}

	var before *model.Employee
	var err error
	if existing == nil {
		doc := bson.M{"company_id": s.Cfg.CompanyID, "user_id": req.UserID, "disabled": false}
		for field, value := range set {
			doc[field] = value
		}
		_, err = s.Store.Employees().InsertOne(ctx, doc)
	} else {
		before = &model.Employee{}
		err = s.Store.Employees().FindOneAndUpdate(ctx, filter, bson.M{"$set": set},
			options.FindOneAndUpdate().SetReturnDocument(options.Before)).Decode(before)
	}
	if err != nil {
		s.recordOperationAudit(ctx, operator, auditEmployeeUpdate, req.UserID, auditResultFailed)
		if errors.Is(err, mongo.ErrNoDocuments) || mongo.IsDuplicateKeyError(err) {
			fail(c, "员工档案已更新，请刷新后重试")
		} else {
			fail(c, "保存失败")
		}
		return
	}
	s.recordOperationAudit(ctx, operator, auditEmployeeUpdate, req.UserID, auditResultSuccess, employeeAuditChanges(before, set)...)

	if e := s.getEmployee(ctx, req.UserID); e != nil {
		ok(c, e)
		return
	}
	ok(c, gin.H{"user_id": req.UserID})
}

// DisableEmployee 停用或启用。停用不删档，历史日报与点评全部保留。
func (s *Server) DisableEmployee(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
	defer cancel()

	operator := auth.UserID(c)
	if !s.isAdmin(ctx, operator) {
		fail(c, "无权管理员工")
		return
	}

	var req struct {
		UserID   string `json:"user_id"`
		Disabled bool   `json:"disabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.UserID) == "" {
		fail(c, "参数错误")
		return
	}

	target := s.getEmployee(ctx, req.UserID)
	if target == nil {
		fail(c, "员工不存在")
		return
	}
	if req.Disabled && req.UserID == operator {
		fail(c, "不能停用自己")
		return
	}

	if req.Disabled {
		// 还有在岗下属时不允许停用，否则这些人的日报会没人能审
		n, err := s.Store.Employees().CountDocuments(ctx, bson.M{
			"company_id": s.Cfg.CompanyID, "manager_id": req.UserID, "disabled": bson.M{"$ne": true},
		})
		if err != nil {
			fail(c, "查询失败")
			return
		}
		if n > 0 {
			fail(c, "该成员还有 "+strconv.Itoa(int(n))+" 名在岗下属，请先转移下属的直属上级")
			return
		}
		// 最后一个管理员不能停用
		if target.IsAdmin {
			if m, _ := s.Store.Employees().CountDocuments(ctx, bson.M{
				"company_id": s.Cfg.CompanyID, "is_admin": true, "disabled": bson.M{"$ne": true},
				"user_id": bson.M{"$ne": req.UserID},
			}); m == 0 {
				fail(c, "至少保留一个管理员")
				return
			}
		}
	}

	var before model.Employee
	if err := s.Store.Employees().FindOneAndUpdate(ctx,
		bson.M{"company_id": s.Cfg.CompanyID, "user_id": req.UserID},
		bson.M{"$set": bson.M{"disabled": req.Disabled}},
		options.FindOneAndUpdate().SetReturnDocument(options.Before),
	).Decode(&before); err != nil {
		s.recordOperationAudit(ctx, operator, auditEmployeeDisable, target.UserID, auditResultFailed)
		fail(c, "操作失败")
		return
	}
	s.recordOperationAudit(ctx, operator, auditEmployeeDisable, target.UserID, auditResultSuccess,
		auditChange("disabled", before.Disabled, req.Disabled))
	ok(c, gin.H{"user_id": req.UserID, "disabled": req.Disabled})
}
