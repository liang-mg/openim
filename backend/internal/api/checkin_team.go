package api

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/xinbo/xinbo-oa/internal/auth"
	"github.com/xinbo/xinbo-oa/internal/model"
)

// dayPair 同一天的上班卡与下班卡。用指针而不是值，便于区分"没打"和"打了但是零点"。
type dayPair struct {
	On  *model.CheckinRecord
	Off *model.CheckinRecord
}

// loadMonth 一次把一批人整月的打卡捞回来再内存聚合。
// 50 人 × 2 次 × 31 天 ≈ 3100 条，一次查询几十毫秒；比按人循环查 50 次快得多。
func (s *Server) loadMonth(ctx context.Context, ids []string, month string) (map[string]map[string]*dayPair, error) {
	out := make(map[string]map[string]*dayPair, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	start, end, valid := monthRange(month)
	if !valid {
		return out, fmt.Errorf("月份格式不正确")
	}
	list, err := s.loadVisibleCheckins(ctx, bson.M{
		"company_id": s.Cfg.CompanyID,
		"user_id":    bson.M{"$in": ids},
		"date":       bson.M{"$gte": start, "$lt": end},
	})
	if err != nil {
		return nil, err
	}
	for i := range list {
		r := &list[i]
		byDate := out[r.UserID]
		if byDate == nil {
			byDate = make(map[string]*dayPair, 31)
			out[r.UserID] = byDate
		}
		p := byDate[r.Date]
		if p == nil {
			p = &dayPair{}
			byDate[r.Date] = p
		}
		if r.Type == "on" {
			p.On = r
		} else if r.Type == "off" {
			p.Off = r
		}
	}
	return out, nil
}

// dayStatusOf 某个人某一天到底算"正常/缺卡/进行中"。
// 关键一条：**今天还没到下班时间，只打了上班卡不算缺卡**，显示"进行中"。
// 以前本人月历在下午三点就把人标成"缺一次卡"，是错的。
func (s *Server) dayStatusOf(p *dayPair, date, today string, nowMin int, rule model.CheckinRule) model.DayStatus {
	rule = dayCheckinRule(p, rule)
	offMin := parseHM(rule.WorkOffTime)
	onMin := parseHM(rule.WorkOnTime) + rule.LateGrace
	restDay := !isWorkday(date, rule.Workdays)

	hasOn := p != nil && p.On != nil
	hasOff := p != nil && p.Off != nil

	st := model.DayStatus{}
	if p != nil {
		st.On, st.Off = p.On, p.Off
	}

	switch {
	case hasOn && hasOff:
		st.State = "done"
	case hasOn:
		// 只打了上班卡：今天且还没到下班点 → 进行中，不判缺卡
		if date == today && nowMin < offMin {
			st.State = "in_progress"
		} else {
			st.State = "partial"
		}
	case hasOff:
		// 只有下班卡，上班卡漏了，也是异常
		st.State = "partial"
	case date > today:
		st.State = "not_yet"
	case date == today && nowMin < onMin:
		st.State = "not_yet"
	case restDay:
		st.State = "rest"
	default:
		st.State = "absent"
	}
	return st
}

// monthStatOf 月度统计。口径统一在这里算，团队表、报表、导出的数字才能一致。
//
// 规则（都是为了"组长看到的数字和他眼睛看到的记录对得上"）：
//  1. 应出勤 = 已过完的工作日 + 今天（前提是今天已经打了上班卡——人来了就算应出勤）。
//     今天还没打卡就不进分母，否则早上七点打开报表人人都是"0/13"。
//  2. 出勤 = 有上班卡的天数（含今天）；补卡通过后生成 checkin 记录，自然算出勤。
//  3. 缺卡 / 单卡只在**已过完**的工作日判定；今天还没到 18:00 不判缺卡、不判单卡。
//  4. 迟到 / 早退按记录如实计数，含今天。
//  5. 已批准的请假日：不算缺卡，也不进应出勤分母（人本来就不用上班）。
//     leaveDays 传 nil 表示还没接请假数据，行为与以前一致。
func (s *Server) monthStatOf(days map[string]*dayPair, leaveDays map[string]bool, month, today string, nowMin int, ruleForDay func(string) model.CheckinRule) model.MonthStat {
	stat := model.MonthStat{}
	t, err := time.Parse("2006-01", month)
	if err != nil {
		return stat
	}
	last := t.AddDate(0, 1, -1).Day()
	for d := 1; d <= last; d++ {
		date := fmt.Sprintf("%s-%02d", month, d)
		if date > today {
			continue
		}
		// 请假日整段跳过：不算应出勤、不算出勤、不算缺卡
		if leaveDays[date] {
			stat.Leave++
			continue
		}
		p := days[date]
		rule := dayCheckinRule(p, ruleForDay(date))
		if !isWorkday(date, rule.Workdays) {
			continue
		}
		offMin := parseHM(rule.WorkOffTime)
		hasOn := p != nil && p.On != nil
		hasOff := p != nil && p.Off != nil
		dayOver := date < today || (date == today && nowMin >= offMin)

		if dayOver || hasOn {
			stat.Workdays++
		}
		if hasOn {
			stat.Attend++
			if p.On.Status == "late" {
				stat.Late++
			}
			if hasOff {
				if p.Off.Status == "early" {
					stat.Early++
				}
			} else if dayOver {
				stat.Partial++
			}
			continue
		}
		if dayOver {
			stat.Absent++
		}
	}
	if stat.Workdays > 0 {
		stat.Rate = int(float64(stat.Attend)/float64(stat.Workdays)*100 + 0.5)
	}
	return stat
}

// memberRow 由档案 + 记录拼出一行团队考勤。
func (s *Server) memberRow(e model.Employee, days map[string]*dayPair, leaveDays map[string]bool, month, date, today string, nowMin int, ruleForDay func(string) model.CheckinRule) model.TeamMemberRow {
	ds := s.dayStatusOf(days[date], date, today, nowMin, ruleForDay(date))
	// 今天请了假：状态显示"请假"，不再标红为未到
	if leaveDays[date] {
		ds.State = "leave"
		ds.On, ds.Off = nil, nil
	}
	row := model.TeamMemberRow{
		UserID:     e.UserID,
		Name:       e.RealName,
		Department: e.Department,
		Position:   e.Position,
		Role:       e.Role,
		Today:      ds,
		Month:      s.monthStatOf(days, leaveDays, month, today, nowMin, ruleForDay),
	}
	row.Exception = ds.State == "absent" || ds.State == "partial" ||
		(ds.On != nil && ds.On.Status == "late") ||
		(ds.Off != nil && ds.Off.Status == "early")
	return row
}

// scopeEmployees 取范围里的员工档案。scope=team 时按汇报链递归，
// 不含自己——组长看"团队"是看下属，自己的记录在"我的"里。
func (s *Server) scopeEmployees(ctx context.Context, ids []string) []model.Employee {
	if len(ids) == 0 {
		return nil
	}
	cur, err := s.Store.Employees().Find(ctx, bson.M{
		"company_id": s.Cfg.CompanyID,
		"user_id":    bson.M{"$in": ids},
		"disabled":   bson.M{"$ne": true},
	})
	if err != nil {
		return nil
	}
	var list []model.Employee
	if err = cur.All(ctx, &list); err != nil {
		return nil
	}
	return list
}

func (s *Server) attendanceEmployees(ctx context.Context, uid, scope, departmentID string) ([]model.Employee, []string, error) {
	people := s.scopeEmployees(ctx, s.visibleUserIDs(ctx, uid, scope))
	if scope == ScopeMine && len(people) == 0 {
		people = []model.Employee{{UserID: uid, RealName: uid, Department: "未分配"}}
	}
	branch := map[string]bool{}
	if departmentID != "" {
		deptIDs, err := s.departmentIDsInBranch(ctx, departmentID)
		if err == mongo.ErrNoDocuments {
			return nil, nil, nil
		}
		if err != nil {
			return nil, nil, err
		}
		for _, id := range deptIDs {
			branch[id] = true
		}
	}
	selected := people[:0]
	ids := make([]string, 0, len(people))
	for _, person := range people {
		if (departmentID == "" || branch[person.DepartmentID]) && (scope != ScopeTeam || person.UserID != uid) {
			selected = append(selected, person)
			ids = append(ids, person.UserID)
		}
	}
	return selected, ids, nil
}

// warnings 把"这套数字还缺什么"如实告诉前端，别让前端自己写死提示。
// 请假已接入（P1-2），原来的 leave_not_integrated 警告去掉。
// 现在还剩两个口径限制，如实说明：周末/法定节假日只按周一至周五判，不含节假日日历。
func checkinWarnings() []string {
	return []string{"holiday_calendar_not_integrated"}
}

// TeamCheckin 团队考勤：组长/领导看下属今天来没来 + 本月表现。
// 越权返回 403，不回空列表——空列表会被误读成"我组里没人"。
func (s *Server) TeamCheckin(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
	defer cancel()

	uid := auth.UserID(c)
	scope, validScope := s.resolveScope(ctx, uid, c.Query("scope"))
	if !validScope {
		failCode(c, 403, "无权查看该范围的考勤")
		return
	}

	now := time.Now()
	today := todayStr(now)
	month := c.Query("month")
	if _, _, valid := monthRange(month); !valid {
		month = today[:7]
	}
	date := c.Query("date")
	if _, err := time.Parse("2006-01-02", date); err != nil {
		date = today
	}

	emps, ids, err := s.attendanceEmployees(ctx, uid, scope, c.Query("department_id"))
	if err != nil {
		fail(c, "查询部门失败")
		return
	}
	byUser, err := s.loadMonth(ctx, ids, month)
	if err != nil {
		fail(c, "查询失败")
		return
	}
	// 请假已接入：把已批准的工作日请假日捞出来，请假日不算缺卡
	leaveByUser := s.approvedLeaveDays(ctx, ids, month)

	timeline, err := s.attendanceRuleTimeline(ctx)
	if err != nil {
		fail(c, "查询考勤规则失败")
		return
	}
	rule := checkinRuleOf(timeline.forDay("", date))
	nowMin := minuteOfDay(now)
	onlyException := c.Query("only_exception") == "1"

	rows := make([]model.TeamMemberRow, 0, len(emps))
	summary := model.TeamCheckinSummary{}
	for _, e := range emps {
		ruleForDay := func(day string) model.CheckinRule {
			return checkinRuleOf(timeline.forDay(e.DepartmentID, day))
		}
		row := s.memberRow(e, byUser[e.UserID], leaveByUser[e.UserID], month, date, today, nowMin, ruleForDay)
		summary.Members++
		if row.Today.On != nil {
			summary.Present++
		}
		if row.Today.State == "absent" {
			summary.Absent++
		}
		if row.Today.On != nil && row.Today.On.Status == "late" {
			summary.Late++
		}
		if row.Today.Off != nil && row.Today.Off.Status == "early" {
			summary.Early++
		}
		if onlyException && !row.Exception {
			continue
		}
		rows = append(rows, row)
	}

	// 异常优先：组长打开页面第一眼要看到"今天谁没来"，不用逐行扫。
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].Exception != rows[j].Exception {
			return rows[i].Exception
		}
		if rows[i].Month.Absent != rows[j].Month.Absent {
			return rows[i].Month.Absent > rows[j].Month.Absent
		}
		return rows[i].Name < rows[j].Name
	})

	ok(c, model.TeamCheckinResult{
		Scope:    scope,
		Month:    month,
		Date:     date,
		Rule:     rule,
		Warnings: checkinWarnings(),
		Summary:  summary,
		Members:  rows,
	})
}

// TeamMemberCheckin 看某个成员的月历（只读）。组长不能改别人的卡，
// 要改只能走补卡申请并留审批痕迹。
func (s *Server) TeamMemberCheckin(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
	defer cancel()

	uid := auth.UserID(c)
	target := c.Param("user_id")
	if target == "" {
		fail(c, "参数错误")
		return
	}
	if target == uid {
		fail(c, "查看自己的记录请用「我的出勤」")
		return
	}

	// 可见性只看关系：目标必须在自己的汇报链里；HR/管理员按全公司范围放行。
	allowed := false
	for _, id := range s.visibleUserIDs(ctx, uid, ScopeTeam) {
		if id == target {
			allowed = true
			break
		}
	}
	if !allowed && s.isAdmin(ctx, uid) {
		allowed = true
	}
	if !allowed {
		failCode(c, 403, "无权查看该成员的考勤")
		return
	}

	emp := s.getEmployee(ctx, target)
	if emp == nil {
		fail(c, "该成员没有员工档案")
		return
	}
	// 停用的人组长看不到（不在汇报链里），但 HR/管理员还能查历史做核对
	if emp.Disabled && !s.isAdmin(ctx, uid) {
		failCode(c, 403, "该成员已停用")
		return
	}

	now := time.Now()
	today := todayStr(now)
	month := c.Query("month")
	if _, _, valid := monthRange(month); !valid {
		month = today[:7]
	}
	start, end, _ := monthRange(month)
	list, err := s.loadVisibleCheckins(ctx, bson.M{
		"company_id": s.Cfg.CompanyID,
		"user_id":    target,
		"date":       bson.M{"$gte": start, "$lt": end},
	})
	if err != nil {
		fail(c, "查询失败")
		return
	}
	if list == nil {
		list = []model.CheckinRecord{}
	}
	timeline, err := s.attendanceRuleTimeline(ctx)
	if err != nil {
		fail(c, "查询考勤规则失败")
		return
	}
	leaveDays, err := s.loadApprovedLeaveDays(ctx, []string{target}, month)
	if err != nil {
		fail(c, "查询请假记录失败")
		return
	}
	ok(c, gin.H{
		"user":                emp,
		"month":               month,
		"total":               len(list),
		"list":                list,
		"rule":                checkinRuleOf(timeline.forDay(emp.DepartmentID, today)),
		"rules_by_date":       timeline.checkinCalendar(emp.DepartmentID, month),
		"approved_leave_days": leaveDays[target],
		"warnings":            checkinWarnings(),
	})
}

// avgClock 平均钟点（HH:MM）。只统计真实打卡记录，缺卡不参与平均，
// 否则"没打卡"会被当成 00:00 把平均值拉飞。
func avgClock(recs []*model.CheckinRecord) string {
	if len(recs) == 0 {
		return ""
	}
	sum := 0
	for _, r := range recs {
		sum += minuteOfDay(time.UnixMilli(r.CheckinTime))
	}
	avg := sum / len(recs)
	return fmt.Sprintf("%02d:%02d", avg/60, avg%60)
}

// AttendanceReport 出勤报表：一人一行 + 合计，可导出 CSV 给 HR 做核算。
func (s *Server) AttendanceReport(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	uid := auth.UserID(c)
	scope, validScope := s.resolveScope(ctx, uid, c.Query("scope"))
	if !validScope {
		failCode(c, 403, "无权查看该范围的报表")
		return
	}

	now := time.Now()
	today := todayStr(now)
	month := c.Query("month")
	if _, _, valid := monthRange(month); !valid {
		month = today[:7]
	}

	result, err := s.buildAttendanceReport(ctx, uid, scope, month, c.Query("department_id"), now)
	if err != nil {
		fail(c, "查询失败")
		return
	}
	switch c.Query("format") {
	case "csv":
		s.writeReportCSV(c, result)
	case "xlsx":
		s.writeReportXLSX(c, result)
	default:
		ok(c, result)
	}
}

func (s *Server) buildAttendanceReport(ctx context.Context, uid, scope, month, departmentID string, now time.Time) (model.AttendanceReport, error) {
	today := todayStr(now)
	emps, ids, err := s.attendanceEmployees(ctx, uid, scope, departmentID)
	if err != nil {
		return model.AttendanceReport{}, err
	}
	byUser, err := s.loadMonth(ctx, ids, month)
	if err != nil {
		return model.AttendanceReport{}, err
	}
	leaveByUser := s.approvedLeaveDays(ctx, ids, month)
	exceptions, err := s.reportExceptions(ctx, ids, month, leaveByUser)
	if err != nil {
		return model.AttendanceReport{}, err
	}

	timeline, err := s.attendanceRuleTimeline(ctx)
	if err != nil {
		return model.AttendanceReport{}, err
	}
	rule := checkinRuleOf(timeline.forDay("", today))
	nowMin := minuteOfDay(now)
	rows := make([]model.ReportRow, 0, len(emps))
	total := model.ReportRow{Name: "合计"}

	for _, e := range emps {
		days := byUser[e.UserID]
		stat := s.monthStatOf(days, leaveByUser[e.UserID], month, today, nowMin, func(day string) model.CheckinRule {
			return checkinRuleOf(timeline.forDay(e.DepartmentID, day))
		})

		var onRecs, offRecs []*model.CheckinRecord
		makeupCount := 0
		for _, p := range days {
			if p.On != nil {
				onRecs = append(onRecs, p.On)
				if p.On.Source == "makeup" {
					makeupCount++
				}
			}
			if p.Off != nil {
				offRecs = append(offRecs, p.Off)
				if p.Off.Source == "makeup" {
					makeupCount++
				}
			}
		}

		row := model.ReportRow{
			UserID:     e.UserID,
			Name:       e.RealName,
			Department: e.Department,
			Position:   e.Position,
			Workdays:   stat.Workdays,
			Attend:     stat.Attend,
			Late:       stat.Late,
			Early:      stat.Early,
			Absent:     stat.Absent,
			Partial:    stat.Partial,
			Leave:      stat.Leave,
			Makeup:     makeupCount,
			Exceptions: exceptions[e.UserID],
			Rate:       stat.Rate,
			AvgOn:      avgClock(onRecs),
			AvgOff:     avgClock(offRecs),
		}
		rows = append(rows, row)

		total.Workdays += row.Workdays
		total.Attend += row.Attend
		total.Late += row.Late
		total.Early += row.Early
		total.Absent += row.Absent
		total.Partial += row.Partial
		total.Leave += row.Leave
		total.Makeup += row.Makeup
		total.Exceptions += row.Exceptions
	}
	if total.Workdays > 0 {
		total.Rate = int(float64(total.Attend)/float64(total.Workdays)*100 + 0.5)
	}

	// 按异常多的人排前面，导出前 HR 一眼能看到需要核对的
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].Absent != rows[j].Absent {
			return rows[i].Absent > rows[j].Absent
		}
		if rows[i].Late != rows[j].Late {
			return rows[i].Late > rows[j].Late
		}
		return rows[i].Name < rows[j].Name
	})

	return model.AttendanceReport{
		Scope:       scope,
		Month:       month,
		Rule:        rule,
		GeneratedAt: now.Format("2006-01-02 15:04"),
		Warnings:    checkinWarnings(),
		Total:       total,
		Rows:        rows,
	}, nil
}

func (s *Server) reportExceptions(ctx context.Context, ids []string, month string, approvedLeave map[string]map[string]bool) (map[string]int, error) {
	counts := map[string]int{}
	rows, err := s.effectiveReportExceptions(ctx, ids, month, approvedLeave)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		counts[row.UserID]++
	}
	return counts, nil
}

func (s *Server) effectiveReportExceptions(ctx context.Context, ids []string, month string, approvedLeave map[string]map[string]bool) ([]model.CheckinException, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	start, end, _ := monthRange(month)
	cur, err := s.Store.Exceptions().Find(ctx, bson.M{
		"company_id": s.Cfg.CompanyID, "user_id": bson.M{"$in": ids},
		"date":   bson.M{"$gte": start, "$lt": end},
		"status": bson.M{"$in": bson.A{"open", "appealed", "resolved"}}, "handler_id": bson.M{"$ne": "system"},
	}, options.Find().SetProjection(bson.M{"user_id": 1, "date": 1}))
	if err != nil {
		return nil, err
	}
	var rows []model.CheckinException
	if err := cur.All(ctx, &rows); err != nil {
		return nil, err
	}
	filtered := rows[:0]
	for _, row := range rows {
		if !approvedLeave[row.UserID][row.Date] {
			filtered = append(filtered, row)
		}
	}
	return filtered, nil
}
