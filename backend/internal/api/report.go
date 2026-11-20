package api

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/xinbo/xinbo-oa/internal/auth"
	"github.com/xinbo/xinbo-oa/internal/model"
)

func nowText() string {
	n := time.Now()
	return fmt.Sprintf("%02d-%02d %02d:%02d", int(n.Month()), n.Day(), n.Hour(), n.Minute())
}

func (s *Server) getEmployee(ctx context.Context, uid string) *model.Employee {
	var e model.Employee
	err := s.Store.Employees().FindOne(ctx, bson.M{
		"company_id": s.Cfg.CompanyID,
		"user_id":    uid,
	}).Decode(&e)
	if err != nil {
		return nil
	}
	return &e
}

// Me 返回当前登录人的 OA 身份，前端据此决定显示组长还是领导视角。
func (s *Server) Me(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	uid := auth.UserID(c)
	if e := s.getEmployee(ctx, uid); e != nil {
		s.fillScopeFlags(ctx, e)
		ok(c, e)
		return
	}
	// 没有员工档案的账号按普通员工处理，保证能正常打卡写日报
	ok(c, model.Employee{
		UserID:     uid,
		RealName:   uid,
		Department: "未分配",
		Role:       "employee",
	})
}

// fillScopeFlags 把"能不能看团队/全公司"算好一起下发。
// 前端不用自己拿角色做 if 判断，权限口径永远只有服务端这一份。
func (s *Server) fillScopeFlags(ctx context.Context, e *model.Employee) {
	e.SubordinateCount = len(s.subordinateIDs(ctx, e.UserID))
	e.CanViewTeam = s.canUseScope(ctx, e.UserID, ScopeTeam) && e.SubordinateCount > 0
	e.CanViewAll = s.canUseScope(ctx, e.UserID, ScopeAll)
}

// authorOf 取报告作者信息；员工档案缺失时退化用 userID，保证流程不中断。
func (s *Server) authorOf(ctx context.Context, uid string) model.ReportAuthor {
	if e := s.getEmployee(ctx, uid); e != nil {
		return model.ReportAuthor{UserID: e.UserID, Name: e.RealName, Department: e.Department}
	}
	return model.ReportAuthor{UserID: uid, Name: uid, Department: "未分配"}
}

// subordinateIDs 直属下属 user_id 列表（停用的不计入，避免离职的人还挂在汇报链上）
func (s *Server) subordinateIDs(ctx context.Context, uid string) []string {
	cur, err := s.Store.Employees().Find(ctx, bson.M{
		"company_id": s.Cfg.CompanyID,
		"manager_id": uid,
		"disabled":   bson.M{"$ne": true},
	})
	if err != nil {
		return nil
	}
	var list []model.Employee
	if err = cur.All(ctx, &list); err != nil {
		return nil
	}
	ids := make([]string, 0, len(list))
	for _, e := range list {
		ids = append(ids, e.UserID)
	}
	return ids
}

// teamIDs 本团队（汇报链上的全部下属，递归到最底层）。
// 原来只展开两层，出现"组长→主管→经理→总监"四级时，经理就看不到第 3 层以下的人。
// 现在统一走 visibleUserIDs，和考勤、待办共用同一套关系计算。
func (s *Server) teamIDs(ctx context.Context, uid string) []string {
	return s.visibleUserIDs(ctx, uid, ScopeTeam)
}

// ReportOverview 员工端概览：只返回当前登录人自己的日报
func (s *Server) ReportOverview(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	uid := auth.UserID(c)
	cur, err := s.Store.Reports().Find(ctx,
		bson.M{"company_id": s.Cfg.CompanyID, "author.user_id": uid},
		options.Find().SetSort(bson.D{{Key: "period", Value: -1}}),
	)
	if err != nil {
		fail(c, "查询失败")
		return
	}
	var mine []*model.ReportRecord
	if err = cur.All(ctx, &mine); err != nil {
		fail(c, "查询失败")
		return
	}
	if mine == nil {
		mine = []*model.ReportRecord{}
	}

	days := map[string]bool{}
	for _, r := range mine {
		days[r.Period] = true
	}
	now := time.Now()
	offset := (int(now.Weekday()) + 6) % 7 // 周一为 0
	weekSubmitted := 0
	for d := 0; d <= offset; d++ {
		if days[todayStr(now.AddDate(0, 0, -d))] {
			weekSubmitted++
		}
	}
	streak := 0
	start := 0
	if !days[todayStr(now)] {
		start = 1
	}
	for d := start; d < 60; d++ {
		if days[todayStr(now.AddDate(0, 0, -d))] {
			streak++
		} else {
			break
		}
	}

	var latest *model.ReviewInfo
	for _, r := range mine {
		if len(r.Reviews) > 0 {
			last := r.Reviews[len(r.Reviews)-1]
			latest = &last
			break
		}
	}

	ok(c, model.ReportOverview{
		WeekSubmitted: weekSubmitted,
		WeekRequired:  5,
		StreakDays:    streak,
		Recent:        mine,
		LatestReview:  latest,
	})
}

type submitReportReq struct {
	Type        string                   `json:"type"`
	Period      string                   `json:"period"`
	Content     model.ReportContent      `json:"content"`
	Attachments []model.ReportAttachment `json:"attachments"`
	Status      string                   `json:"status"`
}

// SubmitReport 提交日报 / 存草稿；同一天已有记录则更新（支持撤回重交、补写昨天）
func (s *Server) SubmitReport(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var req submitReportReq
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, "参数错误")
		return
	}
	if req.Type == "" {
		req.Type = "daily"
	}
	if req.Status != "draft" && req.Status != "submitted" {
		req.Status = "submitted"
	}
	// period 是同一人同一天的唯一键，缺失会写出多条脏记录并污染审阅列表
	if strings.TrimSpace(req.Period) == "" {
		fail(c, "缺少日报日期")
		return
	}
	// 提交（非草稿）必须写今日完成，避免空日报进入组长审阅队列
	if req.Status == "submitted" && strings.TrimSpace(req.Content.Done) == "" {
		fail(c, "今日完成不能为空")
		return
	}
	if req.Attachments == nil {
		req.Attachments = []model.ReportAttachment{}
	}
	// 附件必须是本服务签发的地址：blob:/data: 这类前端临时地址存下来就永远打不开，
	// 宁可提交时报错，也不要让领导点开发现 404。
	uid := auth.UserID(c)
	for _, a := range req.Attachments {
		if !strings.HasPrefix(a.URL, "/oa/api/v1/files/") {
			fail(c, "附件尚未上传成功，请重新添加后再提交")
			return
		}
		// 只能挂自己上传的文件，防止拿别人的 file_id 拼路径越权引用
		fid := strings.TrimPrefix(a.URL, "/oa/api/v1/files/")
		if meta := s.loadFile(ctx, fid); meta == nil || meta.OwnerID != uid {
			fail(c, "附件无效，请重新上传")
			return
		}
	}

	now := time.Now().UnixMilli()

	var exist model.ReportRecord
	err := s.Store.Reports().FindOne(ctx, bson.M{
		"company_id":     s.Cfg.CompanyID,
		"author.user_id": uid,
		"period":         req.Period,
	}).Decode(&exist)

	if err == nil {
		// 已归档：领导已确认的结论不可再被员工覆盖，否则归档内容可被篡改
		if exist.Status == "archived" {
			fail(c, "该日报已归档，不可修改")
			return
		}
		// 已上报领导：组长已点评流转，员工不可再改内容，避免审阅链路前后不一致
		if exist.Status == "pending_leader" {
			fail(c, "该日报已上报领导，不可修改")
			return
		}
		set := bson.M{
			"content":     req.Content,
			"attachments": req.Attachments,
			"status":      req.Status,
			"updated_at":  now,
		}
		if req.Status == "submitted" {
			set["submit_time"] = now
		}
		if _, err = s.Store.Reports().UpdateOne(ctx,
			bson.M{"company_id": s.Cfg.CompanyID, "report_id": exist.ID},
			bson.M{"$set": set},
		); err != nil {
			fail(c, "保存失败")
			return
		}
		_ = s.Store.Reports().FindOne(ctx, bson.M{"company_id": s.Cfg.CompanyID, "report_id": exist.ID}).Decode(&exist)
		ok(c, exist)
		return
	}

	rec := model.ReportRecord{
		ID:          fmt.Sprintf("r_%d", now),
		CompanyID:   s.Cfg.CompanyID,
		Type:        req.Type,
		Period:      req.Period,
		Content:     req.Content,
		Attachments: req.Attachments,
		Status:      req.Status,
		Author:      s.authorOf(ctx, uid),
		Reviews:     []model.ReviewInfo{},
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if req.Status == "submitted" {
		rec.SubmitTime = &now
	}
	if _, err = s.Store.Reports().InsertOne(ctx, rec); err != nil {
		fail(c, "保存失败")
		return
	}
	ok(c, rec)
}

// WithdrawReport 撤回：仅本人、待组长查阅、提交后 2 小时内可撤回为草稿
func (s *Server) WithdrawReport(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var req struct {
		ReportID string `json:"report_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.ReportID == "" {
		fail(c, "参数错误")
		return
	}

	var rec model.ReportRecord
	if err := s.Store.Reports().FindOne(ctx, bson.M{
		"company_id":     s.Cfg.CompanyID,
		"report_id":      req.ReportID,
		"author.user_id": auth.UserID(c),
	}).Decode(&rec); err != nil {
		fail(c, "报告不存在")
		return
	}
	if rec.Status != "submitted" {
		fail(c, "当前状态无法撤回")
		return
	}
	if rec.SubmitTime == nil || time.Now().UnixMilli()-*rec.SubmitTime > 2*60*60*1000 {
		fail(c, "超过提交后 2 小时，无法撤回，请联系组长")
		return
	}
	if _, err := s.Store.Reports().UpdateOne(ctx,
		bson.M{"company_id": s.Cfg.CompanyID, "report_id": req.ReportID},
		bson.M{"$set": bson.M{"status": "draft", "updated_at": time.Now().UnixMilli()}, "$unset": bson.M{"submit_time": ""}},
	); err != nil {
		fail(c, "撤回失败")
		return
	}
	ok(c, gin.H{"report_id": req.ReportID})
}

// ReviewList 组长/领导待查阅列表，按汇报链过滤
func (s *Server) ReviewList(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	uid := auth.UserID(c)
	view := c.Query("view")

	// 角色准入：组长看"待我点评"，领导看"待我审阅"。
	// 只按汇报链过滤会让组长能拉取已上报领导的队列，属于越权。
	role := s.roleOf(ctx, uid)
	isAdmin := s.isAdmin(ctx, uid)
	if view == "leader" {
		if role != "leader" && !isAdmin {
			fail(c, "无权查看该队列")
			return
		}
	} else if role != "manager" && !isAdmin {
		fail(c, "无权查看该队列")
		return
	}

	var ids []string
	status := "submitted"
	if view == "leader" {
		ids = s.teamIDs(ctx, uid)
		status = "pending_leader"
	} else {
		ids = s.subordinateIDs(ctx, uid)
	}
	if len(ids) == 0 {
		ok(c, gin.H{"total": 0, "list": []model.ReportRecord{}})
		return
	}

	cur, err := s.Store.Reports().Find(ctx, bson.M{
		"company_id":     s.Cfg.CompanyID,
		"status":         status,
		"author.user_id": bson.M{"$in": ids},
	}, options.Find().SetSort(bson.D{{Key: "submit_time", Value: -1}}))
	if err != nil {
		fail(c, "查询失败")
		return
	}
	var list []model.ReportRecord
	if err = cur.All(ctx, &list); err != nil {
		fail(c, "查询失败")
		return
	}
	if list == nil {
		list = []model.ReportRecord{}
	}
	ok(c, gin.H{"total": len(list), "list": list})
}

// AllForReview 查阅页：本团队所有待领导查阅 + 已归档
func (s *Server) AllForReview(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	uid := auth.UserID(c)

	// 查阅（含已归档）是领导层权限，组长只做点评上报，不应看到归档全文。
	// 管理员（如独立 HR）也给查阅权，便于核对归档结果。
	role := s.roleOf(ctx, uid)
	if role != "leader" && !s.isAdmin(ctx, uid) {
		fail(c, "无权查阅")
		return
	}

	ids := s.teamIDs(ctx, uid)
	if len(ids) == 0 {
		ok(c, []model.ReportRecord{})
		return
	}
	cur, err := s.Store.Reports().Find(ctx, bson.M{
		"company_id":     s.Cfg.CompanyID,
		"status":         bson.M{"$in": bson.A{"pending_leader", "archived"}},
		"author.user_id": bson.M{"$in": ids},
	}, options.Find().SetSort(bson.D{{Key: "submit_time", Value: -1}}))
	if err != nil {
		fail(c, "查询失败")
		return
	}
	var list []model.ReportRecord
	if err = cur.All(ctx, &list); err != nil {
		fail(c, "查询失败")
		return
	}
	if list == nil {
		list = []model.ReportRecord{}
	}
	ok(c, list)
}

// roleOf 取员工角色，无档案时视为普通员工
func (s *Server) roleOf(ctx context.Context, uid string) string {
	if e := s.getEmployee(ctx, uid); e != nil {
		return e.Role
	}
	return "employee"
}

// canReview 校验当前用户是否有权处理该报告。
// 两层校验缺一不可：① 角色对（组长才能做 manager 动作、领导才能归档）；
// ② 范围对（作者必须在自己下属/团队里）。只判范围会让组长越权归档。
func (s *Server) canReview(ctx context.Context, uid, authorID, view string) bool {
	// 已停用的账号（离职）不再具备任何审阅权限
	if me := s.getEmployee(ctx, uid); me != nil && me.Disabled {
		return false
	}
	role := s.roleOf(ctx, uid)
	isAdmin := s.isAdmin(ctx, uid)

	if view == "leader" {
		if role != "leader" && !isAdmin {
			return false
		}
		for _, id := range s.teamIDs(ctx, uid) {
			if id == authorID {
				return true
			}
		}
		return false
	}

	if role != "manager" && !isAdmin {
		return false
	}
	for _, id := range s.subordinateIDs(ctx, uid) {
		if id == authorID {
			return true
		}
	}
	return false
}

// SubmitReview 提交点评（不改状态，上报/归档由单独接口控制）
func (s *Server) SubmitReview(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var req struct {
		ReportID string `json:"report_id"`
		Comment  string `json:"comment"`
		View     string `json:"view"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.ReportID == "" || req.Comment == "" {
		fail(c, "参数错误")
		return
	}
	if req.View != "leader" {
		req.View = "manager"
	}

	var rec model.ReportRecord
	if err := s.Store.Reports().FindOne(ctx, bson.M{
		"company_id": s.Cfg.CompanyID,
		"report_id":  req.ReportID,
	}).Decode(&rec); err != nil {
		fail(c, "报告不存在")
		return
	}
	uid := auth.UserID(c)
	if !s.canReview(ctx, uid, rec.Author.UserID, req.View) {
		fail(c, "无权处理该报告")
		return
	}

	name := uid
	if e := s.getEmployee(ctx, uid); e != nil {
		name = e.RealName
	}
	review := model.ReviewInfo{
		ReviewerName: name,
		Role:         req.View,
		Comment:      req.Comment,
		ReviewTime:   nowText(),
	}
	if _, err := s.Store.Reports().UpdateOne(ctx,
		bson.M{"company_id": s.Cfg.CompanyID, "report_id": req.ReportID},
		bson.M{"$push": bson.M{"reviews": review}, "$set": bson.M{"updated_at": time.Now().UnixMilli()}},
	); err != nil {
		fail(c, "点评失败")
		return
	}
	ok(c, review)
}

// EscalateReport 组长上报领导：待组长查阅 → 待领导查阅
func (s *Server) EscalateReport(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var req struct {
		ReportID string `json:"report_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.ReportID == "" {
		fail(c, "参数错误")
		return
	}
	var rec model.ReportRecord
	if err := s.Store.Reports().FindOne(ctx, bson.M{
		"company_id": s.Cfg.CompanyID,
		"report_id":  req.ReportID,
	}).Decode(&rec); err != nil {
		fail(c, "报告不存在")
		return
	}
	if !s.canReview(ctx, auth.UserID(c), rec.Author.UserID, "manager") {
		fail(c, "无权处理该报告")
		return
	}
	if _, err := s.Store.Reports().UpdateOne(ctx,
		bson.M{"company_id": s.Cfg.CompanyID, "report_id": req.ReportID},
		bson.M{"$set": bson.M{"status": "pending_leader", "updated_at": time.Now().UnixMilli()}},
	); err != nil {
		fail(c, "上报失败")
		return
	}
	ok(c, gin.H{"report_id": req.ReportID, "status": "pending_leader"})
}

// ArchiveReport 领导归档
func (s *Server) ArchiveReport(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var req struct {
		ReportID string `json:"report_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.ReportID == "" {
		fail(c, "参数错误")
		return
	}
	var rec model.ReportRecord
	if err := s.Store.Reports().FindOne(ctx, bson.M{
		"company_id": s.Cfg.CompanyID,
		"report_id":  req.ReportID,
	}).Decode(&rec); err != nil {
		fail(c, "报告不存在")
		return
	}
	if !s.canReview(ctx, auth.UserID(c), rec.Author.UserID, "leader") {
		fail(c, "无权归档该报告")
		return
	}
	if _, err := s.Store.Reports().UpdateOne(ctx,
		bson.M{"company_id": s.Cfg.CompanyID, "report_id": req.ReportID},
		bson.M{"$set": bson.M{"status": "archived", "updated_at": time.Now().UnixMilli()}},
	); err != nil {
		fail(c, "归档失败")
		return
	}
	ok(c, gin.H{"report_id": req.ReportID, "status": "archived"})
}
