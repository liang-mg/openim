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
	e.CanReviewAttendance = e.CanViewTeam || e.CanViewAll || s.hasAttendanceAssignments(ctx, e.UserID)
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
		if meta := s.loadFile(ctx, fid); meta == nil || meta.OwnerID != uid || fileScopeRequiresRecord(meta.Scope) {
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
		wasDraft := exist.Status == "draft"
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
			"updated_at":  reportUpdatedAt(exist),
		}
		if req.Status == "submitted" {
			set["submit_time"] = now
		}
		result, err := s.Store.Reports().UpdateOne(ctx,
			s.reportUpdateFilter(exist),
			bson.M{"$set": set},
		)
		if err != nil {
			fail(c, "保存失败")
			return
		}
		if result.MatchedCount == 0 {
			fail(c, "日报已变更，请刷新后重试")
			return
		}
		_ = s.Store.Reports().FindOne(ctx, bson.M{"company_id": s.Cfg.CompanyID, "report_id": exist.ID}).Decode(&exist)
		if wasDraft && exist.Status == "submitted" {
			if org, err := s.loadReportReviewOrg(ctx); err == nil {
				s.notifyReportReview(ctx, exist, "submitted", org)
			}
		}
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
	if rec.Status == "submitted" {
		if org, err := s.loadReportReviewOrg(ctx); err == nil {
			s.notifyReportReview(ctx, rec, "submitted", org)
		}
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
	result, err := s.Store.Reports().UpdateOne(ctx,
		s.reportUpdateFilter(rec),
		bson.M{"$set": bson.M{"status": "draft", "updated_at": reportUpdatedAt(rec)}, "$unset": bson.M{"submit_time": ""}},
	)
	if err != nil {
		fail(c, "撤回失败")
		return
	}
	if result.MatchedCount == 0 {
		fail(c, "日报已变更，请刷新后重试")
		return
	}
	ok(c, gin.H{"report_id": req.ReportID})
}

type reportReviewActions struct {
	CanComment  bool `json:"can_comment"`
	CanEscalate bool `json:"can_escalate"`
	CanArchive  bool `json:"can_archive"`
}

type reportForReview struct {
	model.ReportRecord
	Actions reportReviewActions `json:"review_actions"`
}

type reportReviewOrg map[string]model.Employee

func (s *Server) loadReportReviewOrg(ctx context.Context) (reportReviewOrg, error) {
	cur, err := s.Store.Employees().Find(ctx, bson.M{
		"company_id": s.Cfg.CompanyID,
		"disabled":   bson.M{"$ne": true},
	}, options.Find().SetProjection(bson.M{
		"user_id": 1, "manager_id": 1, "role": 1, "is_admin": 1, "real_name": 1,
	}))
	if err != nil {
		return nil, err
	}
	var employees []model.Employee
	if err := cur.All(ctx, &employees); err != nil {
		return nil, err
	}
	org := make(reportReviewOrg, len(employees))
	for _, e := range employees {
		if e.UserID != "" {
			org[e.UserID] = e
		}
	}
	return org, nil
}

func canFinalizeReport(e model.Employee) bool {
	return e.Role == "leader" || e.Role == "hr" || e.Role == "admin" || e.IsAdmin
}

// chain returns the active supervisors from nearest to farthest. A cycle invalidates
// the chain and an absent or disabled supervisor breaks it.
func (org reportReviewOrg) chain(authorID string) []model.Employee {
	author, found := org[authorID]
	if !found || author.Disabled {
		return nil
	}
	visited := map[string]bool{authorID: true}
	var chain []model.Employee
	for id := author.ManagerID; id != ""; {
		if visited[id] {
			return nil
		}
		e, found := org[id]
		if !found || e.Disabled {
			break
		}
		visited[id] = true
		chain = append(chain, e)
		id = e.ManagerID
	}
	return chain
}

func (org reportReviewOrg) actions(uid, authorID, status string) reportReviewActions {
	if uid == "" || uid == authorID || (status != "submitted" && status != "pending_leader") {
		return reportReviewActions{}
	}
	chain := org.chain(authorID)
	if len(chain) == 0 {
		return reportReviewActions{}
	}

	direct := chain[0]
	if status == "submitted" && uid != direct.UserID {
		return reportReviewActions{}
	}
	for _, supervisor := range chain[1:] {
		if !canFinalizeReport(supervisor) {
			continue
		}
		if status == "submitted" {
			return reportReviewActions{CanComment: true, CanEscalate: true}
		}
		if uid == supervisor.UserID {
			return reportReviewActions{CanComment: true, CanArchive: true}
		}
		return reportReviewActions{}
	}
	if status == "submitted" {
		return reportReviewActions{CanComment: true, CanArchive: canFinalizeReport(direct)}
	}
	return reportReviewActions{}
}

func (org reportReviewOrg) canReadArchive(uid, authorID string) bool {
	if !canFinalizeReport(org[uid]) {
		return false
	}
	for _, e := range org.chain(authorID) {
		if e.UserID == uid {
			return true
		}
	}
	return false
}

func (org reportReviewOrg) canReadReport(uid string, rec model.ReportRecord) bool {
	if uid == "" {
		return false
	}
	authorID := rec.Author.UserID
	if uid == authorID {
		return true
	}
	if rec.Status == "draft" {
		return false
	}
	if org.actions(uid, authorID, rec.Status).CanComment ||
		(rec.Status == "archived" && org.canReadArchive(uid, authorID)) {
		return true
	}
	for _, e := range org.chain(authorID) {
		if e.UserID == uid {
			for _, review := range rec.Reviews {
				if review.ReviewerID == uid {
					return true
				}
			}
			break
		}
	}
	return false
}

// queryReportReview matches exactly the authors and phases available to this reviewer.
func (s *Server) queryReportReview(ctx context.Context, uid string, statuses ...string) ([]reportForReview, error) {
	list := []reportForReview{}
	org, err := s.loadReportReviewOrg(ctx)
	if err != nil {
		return nil, err
	}
	var conditions bson.A
	for _, status := range statuses {
		ids := []string{}
		for authorID := range org {
			visible := org.actions(uid, authorID, status).CanComment
			if status == "archived" {
				visible = org.canReadArchive(uid, authorID)
			}
			if visible {
				ids = append(ids, authorID)
			}
		}
		if len(ids) != 0 {
			conditions = append(conditions, bson.M{"status": status, "author.user_id": bson.M{"$in": ids}})
		}
	}
	if len(conditions) == 0 {
		return list, nil
	}
	cur, err := s.Store.Reports().Find(ctx,
		bson.M{"company_id": s.Cfg.CompanyID, "$or": conditions},
		options.Find().SetSort(bson.D{{Key: "submit_time", Value: -1}}),
	)
	if err != nil {
		return nil, err
	}
	var reports []model.ReportRecord
	if err = cur.All(ctx, &reports); err != nil {
		return nil, err
	}
	for _, rec := range reports {
		list = append(list, reportForReview{rec, org.actions(uid, rec.Author.UserID, rec.Status)})
	}
	return list, nil
}

func (s *Server) pendingReportsForReviewer(ctx context.Context, uid string) ([]reportForReview, error) {
	return s.queryReportReview(ctx, uid, "submitted", "pending_leader")
}

// ReviewList keeps the two existing queue views, with access decided per report.
func (s *Server) ReviewList(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	status := "submitted"
	if c.Query("view") == "leader" {
		status = "pending_leader"
	}
	uid := auth.UserID(c)
	list, err := s.queryReportReview(ctx, uid, status)
	if err != nil {
		fail(c, "查询失败")
		return
	}
	s.auditReportReads(ctx, uid, list)
	ok(c, gin.H{"total": len(list), "list": list})
}

// AllForReview returns the viewer's queue and archives, or one explicitly opened report.
func (s *Server) AllForReview(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	uid := auth.UserID(c)
	if reportID := c.Query("report_id"); reportID != "" {
		org, err := s.loadReportReviewOrg(ctx)
		if err != nil {
			fail(c, "查询失败")
			return
		}
		var rec model.ReportRecord
		if err := s.Store.Reports().FindOne(ctx, bson.M{
			"company_id": s.Cfg.CompanyID, "report_id": reportID,
		}).Decode(&rec); err != nil || !org.canReadReport(uid, rec) {
			target := rec.ID
			if target == "" {
				target = "unavailable"
			}
			s.recordOperationAudit(ctx, uid, auditReportRead, target, auditResultDenied)
			fail(c, "日报不存在或无权查看")
			return
		}
		s.recordOperationAudit(ctx, uid, auditReportRead, rec.ID, auditResultSuccess)
		ok(c, []reportForReview{{rec, org.actions(uid, rec.Author.UserID, rec.Status)}})
		return
	}

	list, err := s.queryReportReview(ctx, uid, "submitted", "pending_leader", "archived")
	if err != nil {
		fail(c, "查询失败")
		return
	}
	s.auditReportReads(ctx, uid, list)
	ok(c, list)
}

// roleOf 取员工角色，无档案时视为普通员工
func (s *Server) roleOf(ctx context.Context, uid string) string {
	if e := s.getEmployee(ctx, uid); e != nil {
		return e.Role
	}
	return "employee"
}

func (s *Server) reportUpdateFilter(rec model.ReportRecord) bson.M {
	filter := bson.M{
		"company_id": s.Cfg.CompanyID, "report_id": rec.ID,
		"author.user_id": rec.Author.UserID, "status": rec.Status, "updated_at": rec.UpdatedAt,
	}
	if rec.UpdatedAt == 0 {
		filter["updated_at"] = bson.M{"$in": bson.A{0, nil}}
	}
	return filter
}

func reportUpdatedAt(rec model.ReportRecord) int64 {
	now := time.Now().UnixMilli()
	if now <= rec.UpdatedAt {
		return rec.UpdatedAt + 1
	}
	return now
}

func (s *Server) loadReportForReview(ctx context.Context, c *gin.Context, reportID string) (model.ReportRecord, reportReviewOrg, bool) {
	var rec model.ReportRecord
	if err := s.Store.Reports().FindOne(ctx, bson.M{
		"company_id": s.Cfg.CompanyID, "report_id": reportID,
	}).Decode(&rec); err != nil {
		fail(c, "报告不存在")
		return rec, nil, false
	}
	org, err := s.loadReportReviewOrg(ctx)
	if err != nil {
		fail(c, "查询失败")
		return rec, nil, false
	}
	return rec, org, true
}

func (s *Server) updateReportReview(ctx context.Context, c *gin.Context, rec model.ReportRecord, update bson.M, errorMessage string) bool {
	result, err := s.Store.Reports().UpdateOne(ctx, s.reportUpdateFilter(rec), update)
	if err != nil {
		fail(c, errorMessage)
		return false
	}
	if result.MatchedCount == 0 {
		fail(c, "日报已变更，请刷新后重试")
		return false
	}
	return true
}

// SubmitReview can save a comment and complete its stage in a single write.
func (s *Server) SubmitReview(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var req struct {
		ReportID string `json:"report_id"`
		Comment  string `json:"comment"`
		Complete bool   `json:"complete"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.ReportID == "" || strings.TrimSpace(req.Comment) == "" {
		fail(c, "参数错误")
		return
	}
	rec, org, loaded := s.loadReportForReview(ctx, c, req.ReportID)
	if !loaded {
		return
	}
	uid := auth.UserID(c)
	actions := org.actions(uid, rec.Author.UserID, rec.Status)
	if !actions.CanComment {
		fail(c, "无权处理该报告或状态已变更")
		return
	}

	name := org[uid].RealName
	if name == "" {
		name = uid
	}
	role := "manager"
	if rec.Status == "pending_leader" {
		role = "leader"
	}
	review := model.ReviewInfo{
		ReviewerID:   uid,
		ReviewerName: name,
		Role:         role,
		Comment:      strings.TrimSpace(req.Comment),
		ReviewTime:   nowText(),
	}

	set := bson.M{"updated_at": reportUpdatedAt(rec)}
	if req.Complete {
		switch {
		case actions.CanEscalate:
			set["status"] = "pending_leader"
		case actions.CanArchive:
			set["status"] = "archived"
		default:
			fail(c, "尚未配置终审人")
			return
		}
	}
	if s.updateReportReview(ctx, c, rec, bson.M{"$push": bson.M{"reviews": review}, "$set": set}, "点评失败") {
		ok(c, review)
	}
}

// EscalateReport forwards a submitted report to its authorized final reviewer.
func (s *Server) EscalateReport(c *gin.Context) {
	s.transitionReport(c, "pending_leader")
}

// ArchiveReport completes a report when the viewer is its authorized final reviewer.
func (s *Server) ArchiveReport(c *gin.Context) {
	s.transitionReport(c, "archived")
}

func (s *Server) transitionReport(c *gin.Context, nextStatus string) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var req struct {
		ReportID string `json:"report_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.ReportID == "" {
		fail(c, "参数错误")
		return
	}
	rec, org, loaded := s.loadReportForReview(ctx, c, req.ReportID)
	if !loaded {
		return
	}
	actions := org.actions(auth.UserID(c), rec.Author.UserID, rec.Status)
	if (nextStatus == "pending_leader" && !actions.CanEscalate) || (nextStatus == "archived" && !actions.CanArchive) {
		fail(c, "无权执行该操作或状态已变更")
		return
	}
	update := bson.M{"$set": bson.M{"status": nextStatus, "updated_at": reportUpdatedAt(rec)}}
	if s.updateReportReview(ctx, c, rec, update, "日报状态更新失败") {
		if nextStatus == "pending_leader" {
			s.notifyReportReview(ctx, rec, nextStatus, org)
		}
		ok(c, gin.H{"report_id": req.ReportID, "status": nextStatus})
	}
}
