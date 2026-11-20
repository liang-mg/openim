package api

import (
	"context"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/xinbo/xinbo-oa/internal/auth"
	"github.com/xinbo/xinbo-oa/internal/model"
)

const ruleCacheTTL = time.Minute

var standardWorkdays = []int{1, 2, 3, 4, 5}

// defaultRule 环境变量里的默认值，作为"库里还没配过"时的兜底。
func (s *Server) defaultRule() model.AttendanceRule {
	return model.AttendanceRule{
		CompanyID:      s.Cfg.CompanyID,
		WorkOnTime:     s.Cfg.WorkOnTime,
		WorkOffTime:    s.Cfg.WorkOffTime,
		LateGrace:      s.Cfg.LateGraceMin,
		EarliestOn:     s.Cfg.EarliestOn,
		NeedPhoto:      true,
		NeedLocation:   true,
		Workdays:       standardWorkdays,
		MakeupMaxDays:  s.Cfg.MakeupMaxDays,
		MakeupMaxMonth: s.Cfg.MakeupMaxMonth,
		Source:         "env",
	}
}

// currentRule provides the pre-revision baseline for old records and unconfigured companies.
func (s *Server) currentRule() model.AttendanceRule {
	s.ruleMu.RLock()
	cached, at := s.ruleCache, s.ruleAt
	s.ruleMu.RUnlock()
	if cached != nil && time.Since(at) < ruleCacheTTL {
		return *cached
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var r model.AttendanceRule
	err := s.Store.Rules().FindOne(ctx, bson.M{"company_id": s.Cfg.CompanyID}).Decode(&r)
	if err != nil {
		// 没配过 / 库暂时不可用：用环境变量兜底，保证服务不会因为缺规则而起不来
		r = s.defaultRule()
	} else {
		r.Source = "db"
		if r.Workdays == nil {
			r.Workdays = standardWorkdays
		}
	}
	office := s.officeInfo()
	r.Office = &office

	s.ruleMu.Lock()
	s.ruleCache = &r
	s.ruleAt = time.Now()
	s.ruleMu.Unlock()
	return r
}

type ruleTimeline struct {
	legacy    model.AttendanceRule
	revisions map[string][]model.AttendanceRule
}

func (s *Server) attendanceRuleTimeline(ctx context.Context) (ruleTimeline, error) {
	cur, err := s.Store.RuleRevisions().Find(ctx, bson.M{"company_id": s.Cfg.CompanyID},
		options.Find().SetSort(bson.D{{Key: "effective_date", Value: -1}, {Key: "updated_at", Value: -1}, {Key: "_id", Value: -1}}))
	if err != nil {
		return ruleTimeline{}, err
	}
	var revisions []model.AttendanceRule
	if err := cur.All(ctx, &revisions); err != nil {
		return ruleTimeline{}, err
	}
	timeline := ruleTimeline{legacy: s.currentRule(), revisions: map[string][]model.AttendanceRule{}}
	for _, rule := range revisions {
		rule.Source = "db"
		timeline.revisions[rule.DepartmentID] = append(timeline.revisions[rule.DepartmentID], rule)
	}
	return timeline, nil
}

func (timeline ruleTimeline) forDay(deptID, date string) model.AttendanceRule {
	for _, scope := range []string{deptID, ""} {
		for _, rule := range timeline.revisions[scope] {
			if rule.EffectiveDate <= date {
				return rule
			}
		}
		if scope == "" {
			break
		}
	}
	return timeline.legacy
}

func checkinRuleOf(r model.AttendanceRule) model.CheckinRule {
	return model.CheckinRule{
		WorkOnTime: r.WorkOnTime, WorkOffTime: r.WorkOffTime, LateGrace: r.LateGrace,
		EarliestOn: r.EarliestOn, NeedPhoto: r.NeedPhoto, NeedLocation: r.NeedLocation,
		Workdays: r.Workdays,
	}
}

func dayCheckinRule(pair *dayPair, fallback model.CheckinRule) model.CheckinRule {
	if pair != nil {
		for _, rec := range []*model.CheckinRecord{pair.On, pair.Off} {
			if rec != nil && rec.RuleSnapshot != nil {
				return checkinRuleOf(*rec.RuleSnapshot)
			}
		}
	}
	return fallback
}

func (timeline ruleTimeline) checkinCalendar(deptID, month string) map[string]model.CheckinRule {
	out := map[string]model.CheckinRule{}
	start, err := time.Parse("2006-01", month)
	if err != nil {
		return out
	}
	for d, end := start, start.AddDate(0, 1, 0); d.Before(end); d = d.AddDate(0, 0, 1) {
		date := todayStr(d)
		out[date] = checkinRuleOf(timeline.forDay(deptID, date))
	}
	return out
}

func isWorkday(date string, weekdays []int) bool {
	d, err := time.Parse("2006-01-02", date)
	if err != nil {
		return false
	}
	if weekdays == nil {
		weekdays = standardWorkdays
	}
	for _, day := range weekdays {
		if day == int(d.Weekday()) {
			return true
		}
	}
	return false
}

func (s *Server) attendanceRuleForDate(ctx context.Context, uid, date string) (model.AttendanceRule, error) {
	timeline, err := s.attendanceRuleTimeline(ctx)
	if err != nil {
		return model.AttendanceRule{}, err
	}
	return timeline.forDay(s.employeeDepartmentID(ctx, uid), date), nil
}

func (s *Server) employeeDepartmentID(ctx context.Context, uid string) string {
	if emp := s.getEmployee(ctx, uid); emp != nil {
		return emp.DepartmentID
	}
	return ""
}
func (s *Server) effectiveAttendanceRule(ctx context.Context, uid string) (model.AttendanceRule, error) {
	return s.attendanceRuleForDate(ctx, uid, todayStr(time.Now()))
}

// GetRule returns the effective rule by default. Admins can open a specific rule for editing.
func (s *Server) GetRule(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	uid := auth.UserID(c)
	deptID := c.Query("department_id")
	if deptID != "" || c.Query("scope") == ScopeCompanyRule {
		if !s.isAdmin(ctx, uid) {
			failCode(c, 403, "无权查看该规则")
			return
		}
	} else if emp := s.getEmployee(ctx, uid); emp != nil {
		deptID = emp.DepartmentID
	}
	timeline, err := s.attendanceRuleTimeline(ctx)
	if err != nil {
		fail(c, "查询考勤规则失败")
		return
	}
	ok(c, timeline.forDay(deptID, todayStr(time.Now())))
}

const ScopeCompanyRule = "company"

// SaveRule 保存规则（仅管理员）
func (s *Server) SaveRule(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	uid := auth.UserID(c)
	if !s.isAdmin(ctx, uid) {
		failCode(c, 403, "只有管理员可以修改考勤规则")
		return
	}

	var req model.AttendanceRule
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, "参数错误")
		return
	}
	req.WorkOnTime = strings.TrimSpace(req.WorkOnTime)
	req.WorkOffTime = strings.TrimSpace(req.WorkOffTime)
	req.EarliestOn = strings.TrimSpace(req.EarliestOn)
	if req.EarliestOn == "" {
		req.EarliestOn = "06:30"
	}

	// 边界校验：时间必须是合法 HH:MM，且上班早于下班，否则一整天都会被判迟到/早退
	if !validHM(req.WorkOnTime) || !validHM(req.WorkOffTime) || !validHM(req.EarliestOn) {
		fail(c, "上下班时间格式不正确（HH:MM）")
		return
	}
	if parseHM(req.WorkOnTime) >= parseHM(req.WorkOffTime) {
		fail(c, "下班时间必须晚于上班时间")
		return
	}
	if parseHM(req.EarliestOn) > parseHM(req.WorkOnTime) {
		fail(c, "最早打卡时间不能晚于上班时间")
		return
	}
	if req.LateGrace < 0 || req.LateGrace > 120 {
		fail(c, "迟到宽限应在 0~120 分钟之间")
		return
	}
	if req.MakeupMaxDays < 0 || req.MakeupMaxDays > 90 {
		fail(c, "补卡可补天数应在 0~90 天之间")
		return
	}
	if req.MakeupMaxMonth < 0 || req.MakeupMaxMonth > 99 {
		fail(c, "每月补卡上限应在 0~99 次之间")
		return
	}

	if req.DepartmentID != "" {
		if err := s.Store.Departments().FindOne(ctx, bson.M{
			"company_id": s.Cfg.CompanyID, "department_id": req.DepartmentID,
		}).Err(); err != nil {
			fail(c, "部门不存在")
			return
		}
	}
	timeline, err := s.attendanceRuleTimeline(ctx)
	if err != nil {
		fail(c, "查询考勤规则失败")
		return
	}
	now := time.Now()
	date := todayStr(now)
	previous := timeline.forDay(req.DepartmentID, date)
	if req.Workdays == nil {
		req.Workdays = previous.Workdays
	}
	seen := [7]bool{}
	for _, day := range req.Workdays {
		if day < 0 || day >= len(seen) || seen[day] {
			fail(c, "工作日配置无效")
			return
		}
		seen[day] = true
	}
	if req.Office == nil {
		req.Office = previous.Office
	}
	if req.Office != nil && req.Office.Configured &&
		(!validCoord(req.Office.Lat, req.Office.Lng) || req.Office.Radius <= 0) {
		fail(c, "请设置有效的打卡点坐标和半径")
		return
	}
	req.CompanyID, req.UpdatedBy, req.UpdatedAt, req.EffectiveDate = s.Cfg.CompanyID, uid, now.UnixMilli(), date
	if _, err := s.Store.RuleRevisions().InsertOne(ctx, req); err != nil {
		fail(c, "保存失败")
		return
	}
	req.Source = "db"
	ok(c, req)
}

// validHM 严格校验 HH:MM，避免 "9:5"、"25:00" 这种能过 Sscanf 但没法用的值。
func validHM(v string) bool {
	if len(v) != 5 || v[2] != ':' {
		return false
	}
	for i, ch := range v {
		if i == 2 {
			continue
		}
		if ch < '0' || ch > '9' {
			return false
		}
	}
	h := int(v[0]-'0')*10 + int(v[1]-'0')
	m := int(v[3]-'0')*10 + int(v[4]-'0')
	return h >= 0 && h <= 23 && m >= 0 && m <= 59
}
