package api

import (
	"context"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/xinbo/xinbo-oa/internal/auth"
	"github.com/xinbo/xinbo-oa/internal/model"
)

// 审批中心（P2-2）与日报催交（P2-4）
//
// 设计要点：审批中心**不落自己的表**，只把四类已有数据聚成一个视图。
// 落副本看着快，但请假改一次状态就要同步两处，迟早不一致。
//
// 待办数字与列表必须来自同一个函数（approvalItems）：
// 工作台只取 len()，列表取全量——这样"显示 2 条点进去 0 条"的老问题不会再出现。

const (
	TabPending = "pending" // 待我处理
	TabMine    = "mine"    // 我发起的
	TabDone    = "done"    // 我已处理
)

// approvalItems 聚合审批条目。tab 决定"谁的数据"，kind 只做类型过滤。
func (s *Server) approvalItems(ctx context.Context, uid, tab, kind string) ([]model.ApprovalItem, error) {
	items := make([]model.ApprovalItem, 0, 16)

	if tab == TabPending {
		if me := s.getEmployee(ctx, uid); me != nil && me.Disabled {
			return items, nil
		}
	}

	switch tab {
	case TabMine:
		items = append(items, s.myRequestItems(ctx, uid, kind)...)

	case TabDone:
		items = append(items, s.handledItems(ctx, uid, kind)...)

	default: // pending
		items = append(items, s.pendingRequestItems(ctx, uid, s.visibleUserIDs(ctx, uid, ScopeTeam), kind)...)
	}
	if kind == "" || kind == "report" {
		reports, err := s.reportApprovalItems(ctx, uid, tab)
		if err != nil {
			return nil, err
		}
		items = append(items, reports...)
	}

	sort.SliceStable(items, func(i, j int) bool { return items[i].Time > items[j].Time })
	return items, nil
}

// leaveItem / makeupItem / exceptionItem 把三类源记录转成统一条目。
// 文案在这里统一拼，前端不再各写一遍"事假 3 天"这类拼接。
func leaveItem(r model.LeaveRequest, uid string) model.ApprovalItem {
	can := uid != r.UserID && r.Status == "pending" &&
		(r.ApproverID == uid || r.ApproverID == "")
	return model.ApprovalItem{
		Kind:       "leave",
		KindText:   "请假",
		ID:         r.ID,
		UserID:     r.UserID,
		UserName:   r.UserName,
		Department: r.Department,
		Title:      fmt.Sprintf("%s %d 天", leaveTypeName(r.Type), r.Days),
		Subtitle:   fmt.Sprintf("%s 至 %s · %s", r.StartDate, r.EndDate, r.Reason),
		Status:     r.Status,
		Time:       r.SubmittedAt,
		CanApprove: can,
		Path:       "/leave",
	}
}

func makeupItem(r model.MakeupRequest, uid string) model.ApprovalItem {
	typeText := "上班卡"
	if r.Type == "off" {
		typeText = "下班卡"
	}
	can := uid != r.UserID && r.Status == "pending" &&
		(r.ApproverID == uid || r.ApproverID == "")
	return model.ApprovalItem{
		Kind:       "makeup",
		KindText:   "补卡",
		ID:         r.ID,
		UserID:     r.UserID,
		UserName:   r.UserName,
		Department: r.Department,
		Title:      fmt.Sprintf("补%s %s", typeText, r.Time),
		Subtitle:   fmt.Sprintf("%s · %s", r.Date, r.Reason),
		Status:     r.Status,
		Time:       r.SubmittedAt,
		CanApprove: can,
		Path:       "/leave",
	}
}

func exceptionItem(r model.CheckinException, uid string) model.ApprovalItem {
	return model.ApprovalItem{
		Kind:       "exception",
		KindText:   "考勤异常",
		ID:         r.ID,
		UserID:     r.UserID,
		UserName:   r.UserName,
		Department: r.Department,
		Title:      r.KindText,
		Subtitle:   fmt.Sprintf("%s · %s", r.Date, r.Note),
		Status:     r.Status,
		Time:       r.CreatedAt,
		CanApprove: r.UserID != uid,
		Path:       "/approvals",
	}
}

// pendingRequestItems 待我处理：申请 + 异常。
// 申请还要过一遍 canApproveRequest（审批人字段在创建时按 manager_id 定死了）。
func (s *Server) pendingRequestItems(ctx context.Context, uid string, ids []string, kind string) []model.ApprovalItem {
	out := make([]model.ApprovalItem, 0, 16)
	requestFilter := bson.M{
		"company_id": s.Cfg.CompanyID, "status": "pending", "user_id": bson.M{"$ne": uid},
		"$or": bson.A{
			bson.M{"approver_id": uid},
			bson.M{"approver_id": bson.M{"$in": bson.A{"", nil}}, "user_id": bson.M{"$in": append([]string{}, ids...)}},
		},
	}

	if kind == "" || kind == "leave" {
		cur, err := s.Store.Leaves().Find(ctx, requestFilter)
		if err == nil {
			var list []model.LeaveRequest
			if cur.All(ctx, &list) == nil {
				for _, r := range list {
					if s.canApproveRequest(ctx, uid, r.ApproverID, r.UserID) {
						out = append(out, leaveItem(r, uid))
					}
				}
			}
		}
	}

	if kind == "" || kind == "makeup" {
		cur, err := s.Store.Makeups().Find(ctx, requestFilter)
		if err == nil {
			var list []model.MakeupRequest
			if cur.All(ctx, &list) == nil {
				for _, r := range list {
					if s.canApproveRequest(ctx, uid, r.ApproverID, r.UserID) {
						out = append(out, makeupItem(r, uid))
					}
				}
			}
		}
	}

	if kind == "" || kind == "exception" {
		allowed := append([]string{}, s.exceptionHandlingIDs(ctx, uid)...)
		cur, err := s.Store.Exceptions().Find(ctx, bson.M{
			"company_id": s.Cfg.CompanyID, "status": exceptionPending, "user_id": bson.M{"$in": allowed, "$ne": uid},
		})
		if err == nil {
			var list []model.CheckinException
			if cur.All(ctx, &list) == nil {
				for _, r := range list {
					out = append(out, exceptionItem(r, uid))
				}
			}
		}
	}
	return out
}

// myRequestItems 我发起的（含各状态，方便自己看进度）
func (s *Server) myRequestItems(ctx context.Context, uid, kind string) []model.ApprovalItem {
	out := make([]model.ApprovalItem, 0, 16)

	if kind == "" || kind == "leave" {
		cur, err := s.Store.Leaves().Find(ctx, bson.M{
			"company_id": s.Cfg.CompanyID, "user_id": uid,
		}, options.Find().SetSort(bson.D{{Key: "submitted_at", Value: -1}}).SetLimit(100))
		if err == nil {
			var list []model.LeaveRequest
			if cur.All(ctx, &list) == nil {
				for _, r := range list {
					out = append(out, leaveItem(r, uid))
				}
			}
		}
	}
	if kind == "" || kind == "makeup" {
		cur, err := s.Store.Makeups().Find(ctx, bson.M{
			"company_id": s.Cfg.CompanyID, "user_id": uid,
		}, options.Find().SetSort(bson.D{{Key: "submitted_at", Value: -1}}).SetLimit(100))
		if err == nil {
			var list []model.MakeupRequest
			if cur.All(ctx, &list) == nil {
				for _, r := range list {
					out = append(out, makeupItem(r, uid))
				}
			}
		}
	}
	if kind == "" || kind == "exception" {
		cur, err := s.Store.Exceptions().Find(ctx, bson.M{
			"company_id": s.Cfg.CompanyID, "user_id": uid,
		}, options.Find().SetSort(bson.D{{Key: "date", Value: -1}}).SetLimit(100))
		if err == nil {
			var list []model.CheckinException
			if cur.All(ctx, &list) == nil {
				for _, r := range list {
					it := exceptionItem(r, uid)
					it.CanApprove = false // 自己的异常不能自己处理，只能申诉
					out = append(out, it)
				}
			}
		}
	}
	return out
}

// handledItems 我已处理的（审批人/处理人是我）
func (s *Server) handledItems(ctx context.Context, uid, kind string) []model.ApprovalItem {
	out := make([]model.ApprovalItem, 0, 16)

	if kind == "" || kind == "leave" {
		cur, err := s.Store.Leaves().Find(ctx, bson.M{
			"company_id": s.Cfg.CompanyID, "approver_id": uid, "status": bson.M{"$in": bson.A{"approved", "rejected"}},
		}, options.Find().SetSort(bson.D{{Key: "approved_at", Value: -1}}).SetLimit(100))
		if err == nil {
			var list []model.LeaveRequest
			if cur.All(ctx, &list) == nil {
				for _, r := range list {
					it := leaveItem(r, uid)
					it.CanApprove = false
					it.Time = r.ApprovedAt
					out = append(out, it)
				}
			}
		}
	}
	if kind == "" || kind == "makeup" {
		cur, err := s.Store.Makeups().Find(ctx, bson.M{
			"company_id": s.Cfg.CompanyID, "approver_id": uid, "status": bson.M{"$in": bson.A{"approved", "rejected"}},
		}, options.Find().SetSort(bson.D{{Key: "approved_at", Value: -1}}).SetLimit(100))
		if err == nil {
			var list []model.MakeupRequest
			if cur.All(ctx, &list) == nil {
				for _, r := range list {
					it := makeupItem(r, uid)
					it.CanApprove = false
					it.Time = r.ApprovedAt
					out = append(out, it)
				}
			}
		}
	}
	if kind == "" || kind == "exception" {
		cur, err := s.Store.Exceptions().Find(ctx, bson.M{
			"company_id": s.Cfg.CompanyID, "handler_id": uid,
		}, options.Find().SetSort(bson.D{{Key: "handled_at", Value: -1}}).SetLimit(100))
		if err == nil {
			var list []model.CheckinException
			if cur.All(ctx, &list) == nil {
				for _, r := range list {
					it := exceptionItem(r, uid)
					it.CanApprove = false
					it.Time = r.HandledAt
					out = append(out, it)
				}
			}
		}
	}
	return out
}

func reportReviewPath(reportID string) string {
	return "/report-review?" + url.Values{"report_id": {reportID}}.Encode()
}

func reportApprovalItem(r model.ReportRecord, canApprove bool) model.ApprovalItem {
	title := "工作日报"
	if canApprove && r.Status == "submitted" {
		title = "日报待点评"
	} else if canApprove && r.Status == "pending_leader" {
		title = "日报待终审"
	}
	return model.ApprovalItem{
		Kind: "report", KindText: "日报", ID: r.ID,
		UserID: r.Author.UserID, UserName: r.Author.Name, Department: r.Author.Department,
		Title: title, Subtitle: r.Period + " · " + firstLine(r.Content.Done),
		Status: r.Status, Time: submitTimeOf(r), CanApprove: canApprove,
		Path: reportReviewPath(r.ID),
	}
}

func (s *Server) reportApprovalItems(ctx context.Context, uid, tab string) ([]model.ApprovalItem, error) {
	out := []model.ApprovalItem{}
	if tab == TabPending {
		rows, err := s.pendingReportsForReviewer(ctx, uid)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			out = append(out, reportApprovalItem(row.ReportRecord, true))
		}
		return out, nil
	}

	filter := bson.M{
		"company_id": s.Cfg.CompanyID,
		"status":     bson.M{"$in": bson.A{"submitted", "pending_leader", "archived"}},
	}
	var org reportReviewOrg
	if tab == TabMine {
		filter["author.user_id"] = uid
	} else {
		filter["reviews.reviewer_id"] = uid
		var err error
		org, err = s.loadReportReviewOrg(ctx)
		if err != nil {
			return nil, err
		}
	}

	cur, err := s.Store.Reports().Find(ctx, filter)
	if err != nil {
		return nil, err
	}
	var rows []model.ReportRecord
	if err := cur.All(ctx, &rows); err != nil {
		return nil, err
	}
	for _, row := range rows {
		if tab == TabDone && !org.canReadReport(uid, row) {
			continue
		}
		item := reportApprovalItem(row, false)
		if tab == TabDone {
			item.Time = row.UpdatedAt
		}
		out = append(out, item)
	}
	return out, nil
}

func (s *Server) personalPendingExceptionItems(ctx context.Context, uid string) ([]model.ApprovalItem, error) {
	cur, err := s.Store.Exceptions().Find(ctx, bson.M{
		"company_id": s.Cfg.CompanyID, "user_id": uid, "status": exceptionPending,
	}, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}))
	if err != nil {
		return nil, err
	}
	var rows []model.CheckinException
	if err := cur.All(ctx, &rows); err != nil {
		return nil, err
	}
	out := make([]model.ApprovalItem, 0, len(rows))
	for _, row := range rows {
		out = append(out, exceptionItem(row, uid))
	}
	return out, nil
}

func submitTimeOf(r model.ReportRecord) int64 {
	if r.SubmitTime != nil {
		return *r.SubmitTime
	}
	return r.CreatedAt
}

// firstLine 取正文第一行做摘要，避免列表里塞整篇日报
func firstLine(v string) string {
	v = strings.TrimSpace(v)
	if i := strings.IndexAny(v, "\r\n"); i > 0 {
		v = v[:i]
	}
	r := []rune(v)
	if len(r) > 40 {
		return string(r[:40]) + "…"
	}
	return v
}

// ApprovalList 审批中心列表
func (s *Server) ApprovalList(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	uid := auth.UserID(c)
	tab := c.Query("tab")
	if tab != TabMine && tab != TabDone {
		tab = TabPending
	}
	kind := c.Query("kind")
	if kind != "" && kind != "leave" && kind != "makeup" && kind != "exception" && kind != "report" {
		kind = ""
	}

	var list []model.ApprovalItem
	var err error
	personalPending := tab == TabMine && kind == "exception" && c.Query("status") == "pending"
	if personalPending {
		list, err = s.personalPendingExceptionItems(ctx, uid)
	} else {
		list, err = s.approvalItems(ctx, uid, tab, kind)
	}
	if err != nil {
		fail(c, "查询失败")
		return
	}
	pending := 0
	if tab == TabPending && kind == "" {
		pending = len(list)
	} else {
		// 待办数永远按"待我处理"算，与当前页签无关——页签标题的数字不能跟着切
		if p, e := s.approvalItems(ctx, uid, TabPending, ""); e == nil {
			pending = len(p)
		}
	}

	if tab == TabPending && (c.Query("scope") != "" || c.Query("department_id") != "") {
		scope, allowed := s.resolveScope(ctx, uid, c.Query("scope"))
		if !allowed {
			failCode(c, 403, "无权查看该范围")
			return
		}
		_, ids, err := s.attendanceEmployees(ctx, uid, scope, c.Query("department_id"))
		if err != nil {
			fail(c, "查询部门失败")
			return
		}
		list = filterApprovalItemsForEmployees(list, ids)
	}
	ok(c, model.ApprovalListResult{Tab: tab, Total: len(list), List: list, Pending: pending})
}

func filterApprovalItemsForEmployees(items []model.ApprovalItem, ids []string) []model.ApprovalItem {
	allowed := make(map[string]bool, len(ids))
	for _, id := range ids {
		allowed[id] = true
	}
	filtered := make([]model.ApprovalItem, 0, len(items))
	for _, item := range items {
		if allowed[item.UserID] {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

// SubmitRate 日报提交率：按部门聚合，组长以上才返回未交名单
func (s *Server) SubmitRate(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	uid := auth.UserID(c)
	scope, valid := s.resolveScope(ctx, uid, c.Query("scope"))
	if !valid {
		failCode(c, 403, "无权查看该范围")
		return
	}
	date := c.Query("date")
	today := todayStr(time.Now())
	if _, err := time.Parse("2006-01-02", date); err != nil {
		date = today
	}

	result, err := s.buildSubmitRate(ctx, uid, scope, date, today, c.Query("department_id"))
	if err != nil {
		fail(c, "查询失败")
		return
	}
	ok(c, result)
}

func (s *Server) buildSubmitRate(ctx context.Context, uid, scope, date, today, departmentID string) (model.SubmitRateResult, error) {
	emps, ids, err := s.attendanceEmployees(ctx, uid, scope, departmentID)
	if err != nil {
		return model.SubmitRateResult{}, err
	}
	if len(emps) == 0 {
		return model.SubmitRateResult{Date: date, Today: today, Scope: scope, Rows: []model.SubmitRateRow{}}, nil
	}

	// 已提交 = 只要不是草稿就算（submitted/pending_leader/archived）
	cur, err := s.Store.Reports().Find(ctx, bson.M{
		"company_id":     s.Cfg.CompanyID,
		"period":         date,
		"type":           "daily",
		"status":         bson.M{"$ne": "draft"},
		"author.user_id": bson.M{"$in": ids},
	})
	if err != nil {
		return model.SubmitRateResult{}, err
	}
	var reports []model.ReportRecord
	if err = cur.All(ctx, &reports); err != nil {
		return model.SubmitRateResult{}, err
	}
	done := make(map[string]bool, len(reports))
	for _, r := range reports {
		done[r.Author.UserID] = true
	}

	type bucket struct {
		total     int
		submitted int
		missing   []string
	}
	byDept := map[string]*bucket{}
	order := make([]string, 0, 4)
	for _, e := range emps {
		dept := e.Department
		if dept == "" {
			dept = "未分配"
		}
		b := byDept[dept]
		if b == nil {
			b = &bucket{}
			byDept[dept] = b
			order = append(order, dept)
		}
		b.total++
		if done[e.UserID] {
			b.submitted++
		} else if scope != ScopeMine {
			b.missing = append(b.missing, e.RealName)
		}
	}
	sort.Strings(order)

	result := model.SubmitRateResult{Date: date, Today: today, Scope: scope, Rows: make([]model.SubmitRateRow, 0, len(order))}
	for _, dept := range order {
		b := byDept[dept]
		row := model.SubmitRateRow{
			Department: dept,
			Total:      b.total,
			Submitted:  b.submitted,
			Missing:    b.missing,
		}
		if row.Missing == nil {
			row.Missing = []string{}
		}
		if b.total > 0 {
			row.Rate = int(float64(b.submitted)/float64(b.total)*100 + 0.5)
		}
		result.Total += row.Total
		result.Done += row.Submitted
		result.Rows = append(result.Rows, row)
	}
	if result.Total > 0 {
		result.Rate = int(float64(result.Done)/float64(result.Total)*100 + 0.5)
	}
	return result, nil
}

// UrgeReports 只催交当天未提交的日报。先保存站内通知，再汇总实际 IM 请求结果。
func (s *Server) UrgeReports(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()

	var req struct {
		Date string `json:"date"`
	}
	now := time.Now()
	if err := c.ShouldBindJSON(&req); err != nil || req.Date != todayStr(now) {
		fail(c, "只能催交当天的日报")
		return
	}

	uid := auth.UserID(c)
	scope, valid := s.resolveScope(ctx, uid, c.Query("scope"))
	if !valid || scope == ScopeMine {
		failCode(c, 403, "无权催交")
		return
	}

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
	emps := s.scopeEmployees(ctx, ids)
	if len(emps) == 0 {
		ok(c, urgeReportResult{})
		return
	}

	cur, err := s.Store.Reports().Find(ctx, bson.M{
		"company_id":     s.Cfg.CompanyID,
		"period":         req.Date,
		"type":           "daily",
		"status":         bson.M{"$ne": "draft"},
		"author.user_id": bson.M{"$in": ids},
	})
	if err != nil {
		fail(c, "查询失败")
		return
	}
	var reports []model.ReportRecord
	if err = cur.All(ctx, &reports); err != nil {
		fail(c, "查询失败")
		return
	}
	done := make(map[string]bool, len(reports))
	for _, r := range reports {
		done[r.Author.UserID] = true
	}

	// 升级当天兼容旧版已经发送的催交。新通知用业务日期的唯一键去重。
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	legacyRecipients, err := s.Store.Notifications().Distinct(ctx, "user_id", bson.M{
		"company_id": s.Cfg.CompanyID, "user_id": bson.M{"$in": ids}, "kind": "urge", "path": "/report",
		"_id": bson.M{"$type": "objectId"},
		"created_at": bson.M{"$gte": start.UnixMilli(), "$lt": start.AddDate(0, 0, 1).UnixMilli()},
	})
	if err != nil {
		fail(c, "查询催交记录失败")
		return
	}
	legacy := make(map[string]bool, len(legacyRecipients))
	for _, id := range legacyRecipients {
		if userID, ok := id.(string); ok {
			legacy[userID] = true
		}
	}

	result := urgeReportResult{}
	var records []model.Notification
	for _, e := range emps {
		if done[e.UserID] {
			continue
		}
		if legacy[e.UserID] {
			result.Skipped++
			continue
		}
		rec, err := s.storeNotification(ctx, e.UserID, "urge", req.Date, "日报催交",
			fmt.Sprintf("%s 的日报还没提交，请尽快补交", req.Date), "/report")
		if err != nil {
			result.Failed++
		} else if rec.ID == "" {
			result.Skipped++
		} else {
			records = append(records, rec)
		}
	}
	statuses := s.finishNotifications(records)
	result.Urged = len(records)
	result.IMSucceeded = statuses[imSucceeded]
	result.IMFailed = statuses[imFailed]
	result.IMNotConfigured = statuses[imNotConfigured]
	result.Pushed = result.IMSucceeded > 0
	ok(c, result)
}

type urgeReportResult struct {
	Urged           int  `json:"urged"`
	Skipped         int  `json:"skipped"`
	Failed          int  `json:"failed"`
	Pushed          bool `json:"pushed"`
	IMSucceeded     int  `json:"im_succeeded"`
	IMFailed        int  `json:"im_failed"`
	IMNotConfigured int  `json:"im_not_configured"`
}
