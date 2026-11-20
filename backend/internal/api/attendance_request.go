package api

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/bson/primitive"

	"github.com/xinbo/xinbo-oa/internal/auth"
	"github.com/xinbo/xinbo-oa/internal/model"
)

// 请假 / 补卡：两种"申请类"考勤动作。
// 铁律（开工前 8 条清单第 2 条）：申请一提交就落不可变记录表，审批只改 status，不删记录。
// 请假批准不写 oa_checkin（请假日不是打了卡），只进统计口径；
// 补卡批准写 oa_checkin（补的是一次真实上下班事实），用 source=makeup 标记来源。

var leaveTypes = map[string]string{
	"personal": "事假", "sick": "病假", "annual": "年假", "compoff": "调休", "business": "出差",
}

func leaveTypeName(t string) string {
	if n, ok := leaveTypes[t]; ok {
		return n
	}
	return t
}

// 当天是不是工作日（周末休息）。法定节假日等日历接入后在这里扩展。
func workdayOf(date string) bool {
	d, err := time.Parse("2006-01-02", date)
	if err != nil {
		return false
	}
	return d.Weekday() != time.Saturday && d.Weekday() != time.Sunday
}

// workdaysBetween [start,end] 里的工作日天数；起止倒置返回 0
func workdaysBetween(start, end string) int {
	a, e1 := time.Parse("2006-01-02", start)
	b, e2 := time.Parse("2006-01-02", end)
	if e1 != nil || e2 != nil || a.After(b) {
		return 0
	}
	n := 0
	for d := a; !d.After(b); d = d.AddDate(0, 0, 1) {
		if d.Weekday() != time.Saturday && d.Weekday() != time.Sunday {
			n++
		}
	}
	return n
}

// 这段时间里的工作日日期列表（给统计口径用）
func workdayDates(start, end string) []string {
	a, e1 := time.Parse("2006-01-02", start)
	b, e2 := time.Parse("2006-01-02", end)
	if e1 != nil || e2 != nil || a.After(b) {
		return nil
	}
	out := []string{}
	for d := a; !d.After(b); d = d.AddDate(0, 0, 1) {
		if d.Weekday() != time.Saturday && d.Weekday() != time.Sunday {
			out = append(out, d.Format("2006-01-02"))
		}
	}
	return out
}

// approverOf 审批人 = 申请人的直接上级（关系驱动，不按角色 if）。
// 没有上级时返回空，由 HR/管理员处理（顶层领导自己也走这条路）。
func (s *Server) approverOf(ctx context.Context, uid string) (string, string) {
	e := s.getEmployee(ctx, uid)
	if e == nil || e.ManagerID == "" {
		return "", ""
	}
	name := e.ManagerID
	if m := s.getEmployee(ctx, e.ManagerID); m != nil {
		name = m.RealName
	}
	return e.ManagerID, name
}

// canApproveRequest 审批权限：必须是这条申请指定的审批人，或 HR/管理员。
// 不允许自批自——审批人字段在创建时就按 manager_id 定死了，前端传什么都改不了。
func (s *Server) canApproveRequest(ctx context.Context, uid string, approverID string, applicantID string) bool {
	if uid == applicantID {
		return false
	}
	if uid == approverID && approverID != "" {
		return true
	}
	if approverID == "" && s.isAdmin(ctx, uid) {
		return true
	}
	return approverID == "" && s.roleOf(ctx, uid) == "leader"
}

// applicantDisplayName 无员工档案的人也能申请，名字先用 userID
func (s *Server) applicantDisplayName(ctx context.Context, uid string) model.Employee {
	if e := s.getEmployee(ctx, uid); e != nil {
		return *e
	}
	return model.Employee{UserID: uid, RealName: uid, Department: "未分配", Role: "employee"}
}

// ==================== 请假 ====================

// SubmitLeave 提交请假/出差申请
func (s *Server) SubmitLeave(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var req struct {
		Type      string `json:"type"`
		StartDate string `json:"start_date"`
		EndDate   string `json:"end_date"`
		Reason    string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, "参数错误")
		return
	}
	if _, ok := leaveTypes[req.Type]; !ok {
		fail(c, "请假类型不正确")
		return
	}
	days := workdaysBetween(req.StartDate, req.EndDate)
	if days <= 0 {
		fail(c, "起止日期不正确或不含工作日")
		return
	}
	if strings.TrimSpace(req.Reason) == "" {
		fail(c, "请填写事由")
		return
	}
	// 不能申请超过 120 天的长假（防止脏数据/误填把统计拉飞）
	if days > 120 {
		fail(c, "单次请假不能超过 120 个工作日")
		return
	}

	uid := auth.UserID(c)
	me := s.applicantDisplayName(ctx, uid)
	approverID, approverName := s.approverOf(ctx, uid)
	now := time.Now().UnixMilli()
	rec := model.LeaveRequest{
		ID:           primitive.NewObjectID().Hex(),
		CompanyID:    s.Cfg.CompanyID,
		UserID:       uid,
		UserName:     me.RealName,
		Department:   me.Department,
		Type:         req.Type,
		StartDate:    req.StartDate,
		EndDate:      req.EndDate,
		Days:         days,
		Reason:       strings.TrimSpace(req.Reason),
		Status:       "pending",
		ApproverID:   approverID,
		ApproverName: approverName,
		SubmittedAt:  now,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if _, err := s.Store.Leaves().InsertOne(ctx, rec); err != nil {
		fail(c, "提交失败")
		return
	}
	ok(c, rec)
}

// LeaveList 申请列表：scope=mine 自己的 / team 下属的 / all 全公司
func (s *Server) LeaveList(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	uid := auth.UserID(c)
	scope, valid := s.resolveScope(ctx, uid, c.Query("scope"))
	if !valid {
		failCode(c, 403, "无权查看该范围")
		return
	}
	filter := bson.M{"company_id": s.Cfg.CompanyID}
	if scope == ScopeMine {
		filter["user_id"] = uid
	} else {
		ids := s.visibleUserIDs(ctx, uid, scope)
		if scope == ScopeTeam {
			filtered := make([]string, 0, len(ids))
			for _, id := range ids {
				if id != uid {
					filtered = append(filtered, id)
				}
			}
			ids = filtered
		}
		if len(ids) == 0 {
			ok(c, gin.H{"total": 0, "list": []model.LeaveRequest{}})
			return
		}
		filter["user_id"] = bson.M{"$in": ids}
	}
	if status := c.Query("status"); status != "" {
		filter["status"] = status
	}
	cur, err := s.Store.Leaves().Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "submitted_at", Value: -1}}))
	if err != nil {
		fail(c, "查询失败")
		return
	}
	var list []model.LeaveRequest
	if err = cur.All(ctx, &list); err != nil {
		fail(c, "查询失败")
		return
	}
	if list == nil {
		list = []model.LeaveRequest{}
	}
	ok(c, gin.H{"total": len(list), "list": list})
}

// LeaveApprove 审批请假：action=approve/reject，comment 必填
func (s *Server) LeaveApprove(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	var req struct {
		ID      string `json:"leave_id"`
		Action  string `json:"action"`
		Comment string `json:"comment"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.ID == "" || (req.Action != "approve" && req.Action != "reject") {
		fail(c, "参数错误")
		return
	}
	if strings.TrimSpace(req.Comment) == "" {
		fail(c, "请填写审批意见")
		return
	}
	var rec model.LeaveRequest
	if err := s.Store.Leaves().FindOne(ctx, bson.M{"company_id": s.Cfg.CompanyID, "leave_id": req.ID}).Decode(&rec); err != nil {
		fail(c, "申请不存在")
		return
	}
	uid := auth.UserID(c)
	if me := s.getEmployee(ctx, uid); me != nil && me.Disabled {
		failCode(c, 403, "账号已停用")
		return
	}
	if !s.canApproveRequest(ctx, uid, rec.ApproverID, rec.UserID) {
		failCode(c, 403, "无权审批该申请")
		return
	}
	if rec.Status != "pending" {
		fail(c, "该申请已处理")
		return
	}
	status := "approved"
	if req.Action == "reject" {
		status = "rejected"
	}
	approverName := uid
	if e := s.getEmployee(ctx, uid); e != nil {
		approverName = e.RealName
	}
	if _, err := s.Store.Leaves().UpdateOne(ctx,
		bson.M{"company_id": s.Cfg.CompanyID, "leave_id": req.ID, "status": "pending"},
		bson.M{"$set": bson.M{
			"status": status, "comment": strings.TrimSpace(req.Comment),
			"approver_id": uid, "approver_name": approverName,
			"approved_at": time.Now().UnixMilli(), "updated_at": time.Now().UnixMilli(),
		}},
	); err != nil {
		fail(c, "审批失败")
		return
	}

	// 结果通知申请人（站内信 + 配置了 webhook 时同步推 IM）
	result := "已通过"
	if status == "rejected" {
		result = "已驳回"
	}
	_ = s.notify(ctx, rec.UserID, "approval",
		fmt.Sprintf("请假申请%s", result),
		fmt.Sprintf("%s 至 %s（%d 天）：%s", rec.StartDate, rec.EndDate, rec.Days, strings.TrimSpace(req.Comment)),
		"/leave")

	// 请假通过后，这段时间里已经生成的缺卡异常应该自动核销——
	// 人本来就不用上班，再让组长去点一遍"忽略"是纯浪费。
	if status == "approved" {
		for _, d := range workdayDates(rec.StartDate, rec.EndDate) {
			s.autoResolveException(ctx, rec.UserID, d,
				[]string{model.ExcAbsent, model.ExcMissingOn, model.ExcMissingOff},
				"请假审批通过，自动核销")
		}
	}
	ok(c, gin.H{"status": status})
}

// LeaveCancel 撤销自己的申请（仅 pending）
func (s *Server) LeaveCancel(c *gin.Context) {
	s.cancelRequest(c, s.Store.Leaves(), "leave_id")
}

// ==================== 补卡 ====================

// SubmitMakeup 提交补卡申请
func (s *Server) SubmitMakeup(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	var req struct {
		Date   string `json:"date"`
		Type   string `json:"type"`
		Time   string `json:"time"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, "参数错误")
		return
	}
	if req.Type != "on" && req.Type != "off" {
		fail(c, "补卡类型不正确")
		return
	}
	if _, err := time.Parse("2006-01-02", req.Date); err != nil {
		fail(c, "日期格式不正确")
		return
	}
	today := todayStr(time.Now())
	if req.Date > today {
		fail(c, "不能补未来的卡")
		return
	}
	// 补卡限制以「考勤规则配置」为准（管理员可改），环境变量只是初始落库前的兜底
	rule := s.currentRule()
	maxDays := rule.MakeupMaxDays
	if maxDays > 0 && req.Date < todayStr(time.Now().AddDate(0, 0, -maxDays)) {
		fail(c, fmt.Sprintf("只能补最近 %d 天的卡", maxDays))
		return
	}
	if _, err := time.Parse("15:04", req.Time); err != nil {
		fail(c, "时间格式不正确（HH:MM）")
		return
	}
	if strings.TrimSpace(req.Reason) == "" {
		fail(c, "请填写补卡原因")
		return
	}

	uid := auth.UserID(c)
	// 边界：同一天同一类型已有卡 → 拒绝（含现场打卡和已通过的补卡）
	count, err := s.Store.Checkins().CountDocuments(ctx, bson.M{
		"company_id": s.Cfg.CompanyID, "user_id": uid, "date": req.Date, "type": req.Type,
	})
	if err != nil {
		fail(c, "查询失败")
		return
	}
	if count > 0 {
		fail(c, "该时段已有打卡记录，无需补卡")
		return
	}
	// 边界：同一天同一类型不能有重复的有效申请（rejected/cancelled 可重新申请）
	count, err = s.Store.Makeups().CountDocuments(ctx, bson.M{
		"company_id": s.Cfg.CompanyID, "user_id": uid, "date": req.Date, "type": req.Type,
		"status": bson.M{"$in": []string{"pending", "approved"}},
	})
	if err != nil {
		fail(c, "查询失败")
		return
	}
	if count > 0 {
		fail(c, "该时段已有补卡申请")
		return
	}
	// 边界：每月次数上限
	if rule.MakeupMaxMonth > 0 {
		prefix := req.Date[:7]
		cur, err := s.Store.Makeups().Find(ctx, bson.M{
			"company_id": s.Cfg.CompanyID, "user_id": uid,
			"date": bson.M{"$regex": "^" + prefix},
			"status": bson.M{"$in": []string{"pending", "approved"}},
		})
		if err != nil {
			fail(c, "查询失败")
			return
		}
		n, _ := s.countDocs(ctx, cur)
		if n >= rule.MakeupMaxMonth {
			fail(c, fmt.Sprintf("本月补卡已达上限 %d 次", rule.MakeupMaxMonth))
			return
		}
	}

	me := s.applicantDisplayName(ctx, uid)
	approverID, approverName := s.approverOf(ctx, uid)
	now := time.Now().UnixMilli()
	rec := model.MakeupRequest{
		ID:           primitive.NewObjectID().Hex(),
		CompanyID:    s.Cfg.CompanyID,
		UserID:       uid,
		UserName:     me.RealName,
		Department:   me.Department,
		Date:         req.Date,
		Type:         req.Type,
		Time:         req.Time,
		Reason:       strings.TrimSpace(req.Reason),
		Status:       "pending",
		ApproverID:   approverID,
		ApproverName: approverName,
		SubmittedAt:  now,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if _, err := s.Store.Makeups().InsertOne(ctx, rec); err != nil {
		fail(c, "提交失败")
		return
	}
	ok(c, rec)
}

// countDocs 简单把游标数一下（列表不会很大）
func (s *Server) countDocs(ctx context.Context, cur *mongo.Cursor) (int, error) {
	n := 0
	for cur.Next(ctx) {
		n++
	}
	return n, cur.Err()
}

// MakeupList 补卡申请列表
func (s *Server) MakeupList(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	uid := auth.UserID(c)
	scope, valid := s.resolveScope(ctx, uid, c.Query("scope"))
	if !valid {
		failCode(c, 403, "无权查看该范围")
		return
	}
	filter := bson.M{"company_id": s.Cfg.CompanyID}
	if scope == ScopeMine {
		filter["user_id"] = uid
	} else {
		ids := s.visibleUserIDs(ctx, uid, scope)
		if scope == ScopeTeam {
			filtered := make([]string, 0, len(ids))
			for _, id := range ids {
				if id != uid {
					filtered = append(filtered, id)
				}
			}
			ids = filtered
		}
		if len(ids) == 0 {
			ok(c, gin.H{"total": 0, "list": []model.MakeupRequest{}})
			return
		}
		filter["user_id"] = bson.M{"$in": ids}
	}
	if status := c.Query("status"); status != "" {
		filter["status"] = status
	}
	cur, err := s.Store.Makeups().Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "submitted_at", Value: -1}}))
	if err != nil {
		fail(c, "查询失败")
		return
	}
	var list []model.MakeupRequest
	if err = cur.All(ctx, &list); err != nil {
		fail(c, "查询失败")
		return
	}
	if list == nil {
		list = []model.MakeupRequest{}
	}
	ok(c, gin.H{"total": len(list), "list": list})
}

// MakeupApprove 审批补卡：通过时生成 source=makeup 的 oa_checkin 记录
func (s *Server) MakeupApprove(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	var req struct {
		ID      string `json:"makeup_id"`
		Action  string `json:"action"`
		Comment string `json:"comment"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.ID == "" || (req.Action != "approve" && req.Action != "reject") {
		fail(c, "参数错误")
		return
	}
	if strings.TrimSpace(req.Comment) == "" {
		fail(c, "请填写审批意见")
		return
	}
	var rec model.MakeupRequest
	if err := s.Store.Makeups().FindOne(ctx, bson.M{"company_id": s.Cfg.CompanyID, "makeup_id": req.ID}).Decode(&rec); err != nil {
		fail(c, "申请不存在")
		return
	}
	uid := auth.UserID(c)
	if me := s.getEmployee(ctx, uid); me != nil && me.Disabled {
		failCode(c, 403, "账号已停用")
		return
	}
	if !s.canApproveRequest(ctx, uid, rec.ApproverID, rec.UserID) {
		failCode(c, 403, "无权审批该申请")
		return
	}
	if rec.Status != "pending" {
		fail(c, "该申请已处理")
		return
	}
	status := "approved"
	if req.Action == "reject" {
		status = "rejected"
	}

	approverName := uid
	if e := s.getEmployee(ctx, uid); e != nil {
		approverName = e.RealName
	}
	var checkinID string
	if status == "approved" {
		// 审批通过瞬间再查一次：避免"待审批期间当事人又现场打了卡"
		n, err := s.Store.Checkins().CountDocuments(ctx, bson.M{
			"company_id": s.Cfg.CompanyID, "user_id": rec.UserID, "date": rec.Date, "type": rec.Type,
		})
		if err != nil {
			fail(c, "查询失败")
			return
		}
		if n > 0 {
			fail(c, "该时段已有打卡记录，不能重复补卡")
			return
		}
		rule := s.todayRule()
		// 补卡状态按规则如实判定：补的上班卡晚于上班时间就是迟到，不能因为"补的"就放过
		statusText := "正常"
		st := "normal"
		min := parseHM(rec.Time)
		if rec.Type == "on" && min > parseHM(rule.WorkOnTime)+rule.LateGrace {
			st, statusText = "late", "迟到"
		} else if rec.Type == "off" && min < parseHM(rule.WorkOffTime) {
			st, statusText = "early", "早退"
		}
		checkinID = primitive.NewObjectID().Hex()
		ts, _ := time.ParseInLocation("2006-01-02 15:04", rec.Date+" "+rec.Time, time.Local)
		cr := model.CheckinRecord{
			ID:          checkinID,
			CompanyID:   s.Cfg.CompanyID,
			UserID:      rec.UserID,
			Date:        rec.Date,
			Type:        rec.Type,
			CheckinTime: ts.UnixMilli(),
			Status:      st,
			StatusText:  statusText,
			Source:      "makeup",
			MakeupID:    rec.ID,
			CreatedAt:   time.Now().UnixMilli(),
		}
		if _, err := s.Store.Checkins().InsertOne(ctx, cr); err != nil {
			fail(c, "生成打卡记录失败")
			return
		}
	}
	if _, err := s.Store.Makeups().UpdateOne(ctx,
		bson.M{"company_id": s.Cfg.CompanyID, "makeup_id": req.ID, "status": "pending"},
		bson.M{"$set": bson.M{
			"status": status, "comment": strings.TrimSpace(req.Comment),
			"approver_id": uid, "approver_name": approverName,
			"approved_at": time.Now().UnixMilli(), "updated_at": time.Now().UnixMilli(),
			"checkin_id": checkinID,
		}},
	); err != nil {
		fail(c, "审批失败")
		return
	}

	result := "已通过"
	if status == "rejected" {
		result = "已驳回"
	}
	typeText := "上班卡"
	if rec.Type == "off" {
		typeText = "下班卡"
	}
	_ = s.notify(ctx, rec.UserID, "approval",
		fmt.Sprintf("补卡申请%s", result),
		fmt.Sprintf("%s %s %s：%s", rec.Date, typeText, rec.Time, strings.TrimSpace(req.Comment)),
		"/leave")

	// 补卡通过 = 这一次真实上下班事实补上了，对应的缺卡异常不必再人工处理
	if status == "approved" {
		kinds := []string{model.ExcAbsent}
		if rec.Type == "on" {
			kinds = append(kinds, model.ExcMissingOn)
		} else {
			kinds = append(kinds, model.ExcMissingOff)
		}
		s.autoResolveException(ctx, rec.UserID, rec.Date, kinds, "补卡审批通过，自动核销")
	}
	ok(c, gin.H{"status": status, "checkin_id": checkinID})
}

// MakeupCancel 撤销补卡申请
func (s *Server) MakeupCancel(c *gin.Context) {
	s.cancelRequest(c, s.Store.Makeups(), "makeup_id")
}

// cancelRequest 撤销逻辑两处共用：只能本人撤自己的 pending 申请
func (s *Server) cancelRequest(c *gin.Context, col *mongo.Collection, idField string) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	// 兼容前端传 id / leave_id / makeup_id 三种键名，一次绑定避免重复读 body
	var alt map[string]string
	if err := c.ShouldBindJSON(&alt); err != nil {
		fail(c, "参数错误")
		return
	}
	id := alt["id"]
	if id == "" {
		id = alt[idField]
	}
	if id == "" {
		fail(c, "参数错误")
		return
	}
	uid := auth.UserID(c)
	res, err := col.UpdateOne(ctx,
		bson.M{"company_id": s.Cfg.CompanyID, idField: id, "user_id": uid, "status": "pending"},
		bson.M{"$set": bson.M{"status": "cancelled", "updated_at": time.Now().UnixMilli()}},
	)
	if err != nil || res.MatchedCount == 0 {
		fail(c, "申请不存在或已处理")
		return
	}
	ok(c, gin.H{"status": "cancelled"})
}

// ==================== 已批准的请假日期（给统计口径） ====================

// approvedLeaveDays 取这些人在该月已批准的工作日请假日期，key=userID，value=日期集合。
// 统计口径里"请假日不算缺卡、不算应出勤"就靠它。
func (s *Server) approvedLeaveDays(ctx context.Context, ids []string, month string) map[string]map[string]bool {
	out := make(map[string]map[string]bool, len(ids))
	if len(ids) == 0 {
		return out
	}
	start, end, valid := monthRange(month)
	if !valid {
		return out
	}
	cur, err := s.Store.Leaves().Find(ctx, bson.M{
		"company_id": s.Cfg.CompanyID,
		"user_id":    bson.M{"$in": ids},
		"status":     "approved",
		"$or": []bson.M{
			{"start_date": bson.M{"$gte": start, "$lt": end}},
			{"end_date": bson.M{"$gte": start, "$lt": end}},
			{"start_date": bson.M{"$lt": start}, "end_date": bson.M{"$gte": end}},
		},
	})
	if err != nil {
		return out
	}
	var list []model.LeaveRequest
	if cur.All(ctx, &list) != nil {
		return out
	}
	for _, r := range list {
		for _, d := range workdayDates(r.StartDate, r.EndDate) {
			if d < start || d >= end {
				continue
			}
			if out[r.UserID] == nil {
				out[r.UserID] = map[string]bool{}
			}
			out[r.UserID][d] = true
		}
	}
	return out
}

// AttendancePending 工作台/审批中心的真实待办数（复用 visibleUserIDs）
func (s *Server) AttendancePending(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	uid := auth.UserID(c)
	scope, valid := s.resolveScope(ctx, uid, c.Query("scope"))
	if !valid {
		failCode(c, 403, "无权查看该范围")
		return
	}
	ids := []string{uid}
	if scope != ScopeMine {
		ids = s.visibleUserIDs(ctx, uid, scope)
	}
	filter := bson.M{"company_id": s.Cfg.CompanyID, "status": "pending"}
	if scope == ScopeMine {
		filter["user_id"] = uid
	} else if len(ids) > 0 {
		filter["user_id"] = bson.M{"$in": ids}
	}
	leaveN, e1 := s.Store.Leaves().CountDocuments(ctx, filter)
	makeupN, e2 := s.Store.Makeups().CountDocuments(ctx, filter)
	if e1 != nil || e2 != nil {
		fail(c, "查询失败")
		return
	}
	ok(c, model.AttendancePending{Leave: int(leaveN), Makeup: int(makeupN)})
}
