package api

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/xinbo/xinbo-oa/internal/auth"
	"github.com/xinbo/xinbo-oa/internal/model"
)

func (s *Server) departmentByID(ctx context.Context, id string) (*model.Department, error) {
	var department model.Department
	err := s.Store.Departments().FindOne(ctx, bson.M{"company_id": s.Cfg.CompanyID, "department_id": id}).Decode(&department)
	if err != nil {
		return nil, err
	}
	return &department, nil
}

// departmentIDsInBranch 只解析部门范围。调用方仍须先按账号权限收敛员工范围。
func (s *Server) departmentIDsInBranch(ctx context.Context, id string) ([]string, error) {
	department, err := s.departmentByID(ctx, id)
	if err != nil {
		return nil, err
	}
	ids := []string{department.ID}
	if department.ParentID != "" {
		return ids, nil
	}
	cursor, err := s.Store.Departments().Find(ctx, bson.M{
		"company_id": s.Cfg.CompanyID,
		"parent_id":  department.ID,
	}, options.Find().SetProjection(bson.M{"department_id": 1}))
	if err != nil {
		return nil, err
	}
	var children []model.Department
	if err := cursor.All(ctx, &children); err != nil {
		return nil, err
	}
	for _, child := range children {
		ids = append(ids, child.ID)
	}
	return ids, nil
}

func unlinkedDepartmentFilter() bson.M {
	return bson.M{"$in": bson.A{nil, ""}}
}

func (s *Server) hasAttendanceAssignments(ctx context.Context, uid string) bool {
	if s.Store.Departments().FindOne(ctx, bson.M{
		"company_id": s.Cfg.CompanyID, "head_id": uid,
	}).Err() == nil {
		return true
	}
	filter := bson.M{"company_id": s.Cfg.CompanyID, "approver_id": uid, "user_id": bson.M{"$ne": uid}}
	return s.Store.Leaves().FindOne(ctx, filter).Err() == nil ||
		s.Store.Makeups().FindOne(ctx, filter).Err() == nil
}

func (s *Server) VisibleDepartments(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	uid := auth.UserID(c)
	scope, allowed := s.resolveScope(ctx, uid, c.Query("scope"))
	if !allowed {
		failCode(c, 403, "无权查看该范围")
		return
	}
	type departmentOption struct {
		ID       string `bson:"department_id" json:"department_id"`
		Name     string `bson:"name" json:"name"`
		ParentID string `bson:"parent_id" json:"parent_id"`
	}
	list := []departmentOption{}
	ids := s.visibleUserIDs(ctx, uid, scope)
	if len(ids) == 0 {
		ok(c, gin.H{"list": list})
		return
	}
	membership, err := s.Store.Employees().Distinct(ctx, "department_id", bson.M{
		"company_id": s.Cfg.CompanyID, "user_id": bson.M{"$in": ids},
	})
	if err != nil {
		fail(c, "查询部门失败")
		return
	}
	allowedDepartments := make(map[string]bool, len(membership))
	for _, candidate := range membership {
		if id, ok := candidate.(string); ok && id != "" {
			allowedDepartments[id] = true
		}
	}
	cursor, err := s.Store.Departments().Find(ctx, bson.M{"company_id": s.Cfg.CompanyID},
		options.Find().SetProjection(bson.M{"department_id": 1, "name": 1, "parent_id": 1}).
			SetSort(bson.D{{Key: "name", Value: 1}, {Key: "department_id", Value: 1}}),
	)
	if err != nil {
		fail(c, "查询部门失败")
		return
	}
	var departments []departmentOption
	if err := cursor.All(ctx, &departments); err != nil {
		fail(c, "查询部门失败")
		return
	}
	for _, department := range departments {
		if allowedDepartments[department.ID] && department.ParentID != "" {
			allowedDepartments[department.ParentID] = true
		}
	}
	for _, department := range departments {
		if allowedDepartments[department.ID] {
			list = append(list, department)
		}
	}
	ok(c, gin.H{"list": list})
}

func (s *Server) DepartmentList(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
	defer cancel()
	if !s.isAdmin(ctx, auth.UserID(c)) {
		failCode(c, 403, "无权管理部门")
		return
	}

	cursor, err := s.Store.Departments().Find(ctx, bson.M{"company_id": s.Cfg.CompanyID},
		options.Find().SetSort(bson.D{{Key: "name", Value: 1}, {Key: "department_id", Value: 1}}))
	if err != nil {
		fail(c, "查询部门失败")
		return
	}
	departments := []model.Department{}
	if err := cursor.All(ctx, &departments); err != nil {
		fail(c, "查询部门失败")
		return
	}

	cursor, err = s.Store.Employees().Aggregate(ctx, mongo.Pipeline{
		{{Key: "$match", Value: bson.M{
			"company_id":    s.Cfg.CompanyID,
			"department_id": unlinkedDepartmentFilter(),
			"department":    bson.M{"$type": "string", "$ne": ""},
		}}},
		{{Key: "$group", Value: bson.M{"_id": "$department", "count": bson.M{"$sum": 1}}}},
		{{Key: "$sort", Value: bson.M{"_id": 1}}},
	})
	if err != nil {
		fail(c, "查询旧部门失败")
		return
	}
	unlinked := []struct {
		Name  string `bson:"_id" json:"name"`
		Count int    `bson:"count" json:"count"`
	}{}
	if err := cursor.All(ctx, &unlinked); err != nil {
		fail(c, "查询旧部门失败")
		return
	}
	ok(c, gin.H{"list": departments, "unlinked": unlinked})
}

func (s *Server) SaveDepartment(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
	defer cancel()
	if !s.isAdmin(ctx, auth.UserID(c)) {
		failCode(c, 403, "无权管理部门")
		return
	}

	var req struct {
		ID       string `json:"department_id"`
		Name     string `json:"name"`
		ParentID string `json:"parent_id"`
		HeadID   string `json:"head_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, "参数错误")
		return
	}
	if req.HeadID != "" {
		head := s.getEmployee(ctx, req.HeadID)
		if head == nil || head.Disabled {
			fail(c, "请选择在岗员工担任部门负责人")
			return
		}
	}
	if req.ID != "" {
		var department model.Department
		err := s.Store.Departments().FindOneAndUpdate(ctx,
			bson.M{"company_id": s.Cfg.CompanyID, "department_id": req.ID},
			bson.M{"$set": bson.M{"head_id": req.HeadID}},
		).Decode(&department)
		if errors.Is(err, mongo.ErrNoDocuments) {
			fail(c, "部门不存在")
			return
		}
		if err != nil {
			s.recordOperationAudit(ctx, auth.UserID(c), auditDepartmentSave, req.ID, auditResultFailed)
			fail(c, "保存部门负责人失败")
			return
		}
		s.recordOperationAudit(ctx, auth.UserID(c), auditDepartmentSave, department.ID, auditResultSuccess,
			auditChange("head_id", department.HeadID, req.HeadID))
		department.HeadID = req.HeadID
		ok(c, department)
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || utf8.RuneCountInString(name) > 60 {
		fail(c, "部门名称需为 1–60 个字符")
		return
	}
	if req.ParentID != "" {
		parent, err := s.departmentByID(ctx, req.ParentID)
		if err != nil || parent.ParentID != "" {
			fail(c, "上级部门须为本公司的一级部门")
			return
		}
	}
	department := model.Department{
		ID: primitive.NewObjectID().Hex(), CompanyID: s.Cfg.CompanyID,
		Name: name, ParentID: req.ParentID, HeadID: req.HeadID,
	}
	if _, err := s.Store.Departments().InsertOne(ctx, department); err != nil {
		if mongo.IsDuplicateKeyError(err) {
			fail(c, "同一级下已存在同名部门")
			return
		}
		fail(c, "创建部门失败")
		return
	}
	s.recordOperationAudit(ctx, auth.UserID(c), auditDepartmentSave, department.ID, auditResultSuccess,
		auditChange("name", nil, department.Name), auditChange("parent_id", nil, department.ParentID),
		auditChange("head_id", nil, department.HeadID))
	ok(c, department)
}

func (s *Server) MigrateDepartment(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
	defer cancel()
	if !s.isAdmin(ctx, auth.UserID(c)) {
		failCode(c, 403, "无权管理部门")
		return
	}
	var req struct {
		LegacyName string `json:"legacy_name"`
		ID         string `json:"department_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.LegacyName == "" || req.ID == "" {
		fail(c, "请选择旧部门名称和新部门")
		return
	}
	department, err := s.departmentByID(ctx, req.ID)
	if err != nil {
		fail(c, "目标部门不存在")
		return
	}
	result, err := s.Store.Employees().UpdateMany(ctx, bson.M{
		"company_id":    s.Cfg.CompanyID,
		"department":    req.LegacyName,
		"department_id": unlinkedDepartmentFilter(),
	}, bson.M{"$set": bson.M{"department_id": department.ID, "department": department.Name}})
	if err != nil {
		s.recordOperationAudit(ctx, auth.UserID(c), auditDepartmentLink, department.ID, auditResultFailed)
		fail(c, "关联旧部门失败")
		return
	}
	s.recordOperationAudit(ctx, auth.UserID(c), auditDepartmentLink, department.ID, auditResultSuccess,
		auditChange("department", req.LegacyName, department.Name), auditChange("linked", nil, result.ModifiedCount))
	ok(c, gin.H{"linked": result.ModifiedCount})
}
