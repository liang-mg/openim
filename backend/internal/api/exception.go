package api

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/bson/primitive"

	"github.com/xinbo/xinbo-oa/internal/auth"
	"github.com/xinbo/xinbo-oa/internal/model"
)

// 考勤异常（P1-5）
//
// 一句话：**扫描按 dayStatusOf 的同一套口径产出异常，人工处理只改状态。**
//
// 为什么不在打卡时实时写异常：迟到/早退能实时判，但"缺下班卡"要等到下班时间之后，
// "整日缺卡"要等下班后仍无记录。统一用一次扫描算，规则只有一份，不会出现
// "打卡接口判一套、报表判另一套"的分叉。

// exceptionPending 待处理状态集合（open 未处理 / appealed 已申诉待认定）
var exceptionPending = bson.M{"$in": []string{"open", "appealed"}}

func exceptionStatusText(s string) string {
	switch s {
	case "open":
		return "待处理"
	case "appealed":
		return "已申诉"
	case "resolved":
		return "已认定"
	case "ignored":
		return "已忽略"
	}
	return s
}

// scanExceptionsFor 核心扫描：给一批人、一段时间，产出/更新异常记录。
//
// 幂等靠唯一索引 (company_id,user_id,date,kind) + $setOnInsert：
// 已经处理过的异常不会被重复扫描改回 open，重跑扫描不会刷掉组长的处理结果。
func (s *Server) scanExceptionsFor(ctx context.Context, ids []string, from, to string) (model.ScanResult, error) {
	res := model.ScanResult{From: from, To: to}
	if len(ids) == 0 {
		return res, nil
	}
	start, err1 := time.Parse("2006-01-02", from)
	end, err2 := time.Parse("2006-01-02", to)
	if err1 != nil || err2 != nil || start.After(end) {
		return res, fmt.Errorf("日期范围不正确")
	}

	// 员工档案：扫描要写姓名与部门，不能只存 userID（组长看列表要认得出人）
	emps := s.scopeEmployees(ctx, ids)
	nameOf := make(map[string]model.Employee, len(emps))
	for _, e := range emps {
		nameOf[e.UserID] = e
	}

	today := todayStr(time.Now())
	rule := s.todayRule()
	nowMin := minuteOfDay(time.Now())

	// 跨月时按月分批：loadMonth 与 approvedLeaveDays 都是按月查的
	months := map[string]bool{}
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		months[d.Format("2006-01")] = true
	}

	for month := range months {
		byUser, lerr := s.loadMonth(ctx, ids, month)
		if lerr != nil {
			return res, lerr
		}
		leaveByUser := s.approvedLeaveDays(ctx, ids, month)

		for _, uid := range ids {
			emp, hasEmp := nameOf[uid]
			if !hasEmp {
				continue // 没有档案的人不算考勤（也没人能从组织上管他）
			}
			days := byUser[uid]
			leaves := leaveByUser[uid]
			for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
				date := todayStr(d)
				if date > today || isWeekendDate(date) {
					continue
				}
				// 今天还没到下班的点，一切都不算数——不然早上九点全组都是"缺下班卡"
				if date == today && nowMin < parseHM(rule.WorkOffTime) {
					continue
				}
				// 已批准请假：人本来就不用上班，不产异常
				if leaves[date] {
					continue
				}
				res.Scanned++

				kinds := exceptionKindsOf(days[date], rule)
				for _, k := range kinds {
					created, uerr := s.upsertException(ctx, emp, date, k.Kind, k.Note, k.CheckinID)
					if uerr != nil {
						return res, uerr
					}
					if created {
						res.Created++
					} else {
						res.Skipped++
					}
				}
			}
		}
	}
	return res, nil
}

type excKind struct {
	Kind      string
	Note      string
	CheckinID string
}

// exceptionKindsOf 一天的异常类型。整日无卡只出一条 absent，
// 不再额外拆 missing_on/off，否则一个人一天刷三条，组长看得想关页面。
func exceptionKindsOf(p *dayPair, rule model.CheckinRule) []excKind {
	out := make([]excKind, 0, 3)
	hasOn := p != nil && p.On != nil
	hasOff := p != nil && p.Off != nil

	switch {
	case !hasOn && !hasOff:
		return append(out, excKind{Kind: model.ExcAbsent, Note: "当天没有打卡记录"})
	case !hasOn && hasOff:
		out = append(out, excKind{Kind: model.ExcMissingOn, Note: "只有下班卡，缺上班卡", CheckinID: p.Off.ID})
	case hasOn && !hasOff:
		out = append(out, excKind{Kind: model.ExcMissingOff, Note: "只有上班卡，缺下班卡", CheckinID: p.On.ID})
	}

	if hasOn && p.On.Status == "late" {
		out = append(out, excKind{
			Kind:      model.ExcLate,
			Note:      fmt.Sprintf("%s 打卡，晚于上班时间 %s（宽限 %d 分钟）", hhmm(p.On.CheckinTime), rule.WorkOnTime, rule.LateGrace),
			CheckinID: p.On.ID,
		})
	}
	if hasOff && p.Off.Status == "early" {
		out = append(out, excKind{
			Kind:      model.ExcEarly,
			Note:      fmt.Sprintf("%s 打卡，早于下班时间 %s", hhmm(p.Off.CheckinTime), rule.WorkOffTime),
			CheckinID: p.Off.ID,
		})
	}
	// 范围外只在"配置过打卡点"时才判：没配打卡点就只记坐标，不能凭空说人家位置异常
	for _, r := range []*model.CheckinRecord{p.On, p.Off} {
		if r != nil && r.FenceSet && !r.InFence {
			out = append(out, excKind{
				Kind:      model.ExcOutsideFence,
				Note:      fmt.Sprintf("打卡点距离 %s，超出允许范围", fmtDistance(r.Distance)),
				CheckinID: r.ID,
			})
			break // 一天只出一条位置异常，不按上下班卡重复刷
		}
	}
	return out
}

// upsertException 写一条异常。返回 true 表示新建，false 表示已存在（保持原状态）。
func (s *Server) upsertException(ctx context.Context, emp model.Employee, date, kind, note, checkinID string) (bool, error) {
	now := time.Now().UnixMilli()
	res, err := s.Store.Exceptions().UpdateOne(ctx,
		bson.M{"company_id": s.Cfg.CompanyID, "user_id": emp.UserID, "date": date, "kind": kind},
		bson.M{"$setOnInsert": bson.M{
			"exception_id": primitive.NewObjectID().Hex(),
			"company_id":   s.Cfg.CompanyID,
			"user_id":      emp.UserID,
			"user_name":    emp.RealName,
			"department":   emp.Department,
			"date":         date,
			"kind":         kind,
			"kind_text":    model.ExceptionKindText[kind],
			"status":       "open",
			"note":         note,
			"checkin_id":   checkinID,
			"created_at":   now,
			"updated_at":   now,
		}},
		options.Update().SetUpsert(true),
	)
	if err != nil {
		return false, err
	}
	return res.UpsertedID != nil, nil
}

// ScanExceptions 手动触发扫描（管理员/领导/组长，范围即自己能看到的人）。
// 默认只回溯 3 天，最多 31 天——防止误点一下把整年历史刷成待办。
func (s *Server) ScanExceptions(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
	defer cancel()

	uid := auth.UserID(c)
	scope, valid := s.resolveScope(ctx, uid, c.Query("scope"))
	if !valid || scope == ScopeMine {
		failCode(c, 403, "无权触发考勤扫描")
		return
	}

	days := 3
	if v := c.Query("days"); v != "" {
		if n, err := parsePositiveInt(v); err == nil {
			days = n
		}
	}
	if days < 1 {
		days = 1
	}
	if days > 31 {
		days = 31
	}

	now := time.Now()
	to := todayStr(now)
	// 今天还没到下班点就扫到昨天，免得把"还没下班"扫成缺卡
	if minuteOfDay(now) < parseHM(s.todayRule().WorkOffTime) {
		to = todayStr(now.AddDate(0, 0, -1))
	}
	from := todayStr(now.AddDate(0, 0, -(days - 1)))

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

	res, err := s.scanExceptionsFor(ctx, ids, from, to)
	if err != nil {
		fail(c, "扫描失败："+err.Error())
		return
	}
	ok(c, res)
}

// parsePositiveInt 只接受正整数，避免 Atoi 之外的脏输入
func parsePositiveInt(v string) (int, error) {
	n := 0
	if v == "" {
		return 0, fmt.Errorf("empty")
	}
	for _, ch := range v {
		if ch < '0' || ch > '9' {
			return 0, fmt.Errorf("not a number")
		}
		n = n*10 + int(ch-'0')
		if n > 100000 {
			return 0, fmt.Errorf("too large")
		}
	}
	return n, nil
}

// ExceptionList 异常列表。scope=mine 自己的 / team 下属的 / all 全公司。
// status=pending 表示"待处理（含已申诉）"，前端默认看这个。
func (s *Server) ExceptionList(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
	defer cancel()

	uid := auth.UserID(c)
	scope, valid := s.resolveScope(ctx, uid, c.Query("scope"))
	if !valid {
		failCode(c, 403, "无权查看该范围")
		return
	}

	month := c.Query("month")
	if _, _, validMonth := monthRange(month); !validMonth {
		month = todayStr(time.Now())[:7]
	}
	start, end, _ := monthRange(month)

	filter := bson.M{
		"company_id": s.Cfg.CompanyID,
		"date":       bson.M{"$gte": start, "$lt": end},
	}
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
			ok(c, model.ExceptionListResult{Scope: scope, Month: month, List: []model.CheckinException{}})
			return
		}
		filter["user_id"] = bson.M{"$in": ids}
	}

	switch st := c.Query("status"); st {
	case "pending":
		filter["status"] = exceptionPending
	case "open", "appealed", "resolved", "ignored":
		filter["status"] = st
	}
	if kind := c.Query("kind"); kind != "" {
		filter["kind"] = kind
	}

	cur, err := s.Store.Exceptions().Find(ctx, filter,
		options.Find().SetSort(bson.D{{Key: "date", Value: -1}, {Key: "created_at", Value: -1}}).SetLimit(500))
	if err != nil {
		fail(c, "查询失败")
		return
	}
	var list []model.CheckinException
	if err = cur.All(ctx, &list); err != nil {
		fail(c, "查询失败")
		return
	}
	if list == nil {
		list = []model.CheckinException{}
	}

	// 汇总按"当前筛选出来的这批数据"算，页签上的数字才和列表条数对得上
	sum := model.ExceptionSummary{Total: len(list)}
	for _, e := range list {
		switch e.Status {
		case "open":
			sum.Open++
		case "appealed":
			sum.Appealed++
		case "resolved":
			sum.Resolved++
		case "ignored":
			sum.Ignored++
		}
	}

	ok(c, model.ExceptionListResult{
		Scope:   scope,
		Month:   month,
		Summary: sum,
		Total:   len(list),
		List:    list,
	})
}

// canHandleTarget 能不能处理这个人的异常：必须在自己能看到的范围里，且不是自己。
// 沿用一个原则——权限看关系，不看角色字符串。
func (s *Server) canHandleTarget(ctx context.Context, uid, target string) bool {
	if uid == target {
		return false // 自己给自己认定异常没有意义
	}
	if s.isAdmin(ctx, uid) {
		return true
	}
	for _, id := range s.visibleUserIDs(ctx, uid, ScopeTeam) {
		if id == target {
			return true
		}
	}
	return false
}

// ExceptionHandle 处理异常：action=resolve（认定属实）/ ignore（不算异常），必须写意见。
func (s *Server) ExceptionHandle(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var req struct {
		ID      string `json:"exception_id"`
		Action  string `json:"action"`
		Comment string `json:"comment"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.ID == "" ||
		(req.Action != "resolve" && req.Action != "ignore") {
		fail(c, "参数错误")
		return
	}
	if strings.TrimSpace(req.Comment) == "" {
		fail(c, "请填写处理意见")
		return
	}

	var rec model.CheckinException
	if err := s.Store.Exceptions().FindOne(ctx, bson.M{
		"company_id": s.Cfg.CompanyID, "exception_id": req.ID,
	}).Decode(&rec); err != nil {
		fail(c, "异常记录不存在")
		return
	}

	uid := auth.UserID(c)
	if me := s.getEmployee(ctx, uid); me != nil && me.Disabled {
		failCode(c, 403, "账号已停用")
		return
	}
	if !s.canHandleTarget(ctx, uid, rec.UserID) {
		failCode(c, 403, "无权处理该成员的考勤异常")
		return
	}
	if rec.Status != "open" && rec.Status != "appealed" {
		fail(c, "该异常已处理")
		return
	}

	status := "resolved"
	if req.Action == "ignore" {
		status = "ignored"
	}
	name := uid
	if e := s.getEmployee(ctx, uid); e != nil {
		name = e.RealName
	}
	now := time.Now().UnixMilli()
	res, err := s.Store.Exceptions().UpdateOne(ctx,
		bson.M{"company_id": s.Cfg.CompanyID, "exception_id": req.ID,
			"status": bson.M{"$in": []string{"open", "appealed"}}},
		bson.M{"$set": bson.M{
			"status": status, "comment": strings.TrimSpace(req.Comment),
			"handler_id": uid, "handler_name": name,
			"handled_at": now, "updated_at": now,
		}},
	)
	if err != nil || res.MatchedCount == 0 {
		fail(c, "处理失败或该异常已被他人处理")
		return
	}

	// 结果通知本人：被认定为异常（resolve）才通知，忽略就不打扰
	if status == "resolved" {
		_ = s.notify(ctx, rec.UserID, "exception", "考勤异常已认定",
			fmt.Sprintf("%s %s：%s", rec.Date, rec.KindText, strings.TrimSpace(req.Comment)), "/attendance")
	}
	ok(c, gin.H{"status": status})
}

// ExceptionAppeal 本人申诉：只能申诉自己的、还在 open 的记录。
func (s *Server) ExceptionAppeal(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var req struct {
		ID   string `json:"exception_id"`
		Note string `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.ID == "" {
		fail(c, "参数错误")
		return
	}
	if strings.TrimSpace(req.Note) == "" {
		fail(c, "请填写申诉理由")
		return
	}

	uid := auth.UserID(c)
	now := time.Now().UnixMilli()
	res, err := s.Store.Exceptions().UpdateOne(ctx,
		bson.M{"company_id": s.Cfg.CompanyID, "exception_id": req.ID,
			"user_id": uid, "status": "open"},
		bson.M{"$set": bson.M{
			"status": "appealed", "comment": strings.TrimSpace(req.Note),
			"updated_at": now,
		}},
	)
	if err != nil || res.MatchedCount == 0 {
		fail(c, "申诉失败：记录不存在或已处理")
		return
	}
	ok(c, gin.H{"status": "appealed"})
}

// autoResolveException 业务动作自动核销异常：补卡通过后，当天的缺卡异常就不该再挂着。
// 只核销 open/appealed 状态的同类异常，已被人处理过的不动。
func (s *Server) autoResolveException(ctx context.Context, uid, date string, kinds []string, reason string) {
	if len(kinds) == 0 {
		return
	}
	_, err := s.Store.Exceptions().UpdateMany(ctx,
		bson.M{
			"company_id": s.Cfg.CompanyID, "user_id": uid, "date": date,
			"kind":   bson.M{"$in": kinds},
			"status": exceptionPending,
		},
		bson.M{"$set": bson.M{
			"status": "resolved", "comment": reason,
			"handler_id": "system", "handler_name": "系统",
			"handled_at": time.Now().UnixMilli(), "updated_at": time.Now().UnixMilli(),
		}},
	)
	if err != nil {
		log.Printf("[exception] auto resolve failed uid=%s date=%s: %v", uid, date, err)
	}
}

// openExceptionCount 待处理异常数量（工作台待办用）。
// mine=true 只数自己的，否则数这批人里的。
func (s *Server) openExceptionCount(ctx context.Context, ids []string) int {
	if len(ids) == 0 {
		return 0
	}
	n, err := s.Store.Exceptions().CountDocuments(ctx, bson.M{
		"company_id": s.Cfg.CompanyID,
		"user_id":    bson.M{"$in": ids},
		"status":     exceptionPending,
	})
	if err != nil {
		return 0
	}
	return int(n)
}

// AutoScanLoop 后台定时扫描：每 30 分钟扫最近 3 天。
// 不用 cron 的原因是"最近 3 天"本身就能自愈——服务停一天，重启后第一次扫描就补齐了。
func (s *Server) AutoScanLoop() {
	if !s.Cfg.AutoScan {
		log.Printf("[exception] auto scan disabled (OA_AUTO_SCAN=false)")
		return
	}
	go func() {
		// 启动先跑一次，把停机期间漏的补上
		s.runAutoScan()
		t := time.NewTicker(30 * time.Minute)
		defer t.Stop()
		for range t.C {
			s.runAutoScan()
		}
	}()
}

func (s *Server) runAutoScan() {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	cur, err := s.Store.Employees().Find(ctx, bson.M{
		"company_id": s.Cfg.CompanyID,
		"disabled":   bson.M{"$ne": true},
	})
	if err != nil {
		log.Printf("[exception] auto scan: load employees failed: %v", err)
		return
	}
	var emps []model.Employee
	if err = cur.All(ctx, &emps); err != nil || len(emps) == 0 {
		return
	}
	ids := make([]string, 0, len(emps))
	for _, e := range emps {
		ids = append(ids, e.UserID)
	}

	now := time.Now()
	to := todayStr(now)
	if minuteOfDay(now) < parseHM(s.todayRule().WorkOffTime) {
		to = todayStr(now.AddDate(0, 0, -1))
	}
	from := todayStr(now.AddDate(0, 0, -3))
	res, err := s.scanExceptionsFor(ctx, ids, from, to)
	if err != nil {
		log.Printf("[exception] auto scan failed: %v", err)
		return
	}
	if res.Created > 0 {
		log.Printf("[exception] auto scan %s~%s: scanned=%d created=%d skipped=%d", from, to, res.Scanned, res.Created, res.Skipped)
	}
}
