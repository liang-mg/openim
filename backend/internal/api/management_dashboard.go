package api

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/xinbo/xinbo-oa/internal/auth"
)

type dashboardExceptionDay struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

func (s *Server) ManagementDashboard(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	uid := auth.UserID(c)
	employee := s.getEmployee(ctx, uid)
	if employee == nil || employee.Disabled {
		failCode(c, 403, "无权查看管理看板")
		return
	}
	requested := c.Query("scope")
	if requested == "" {
		requested = ScopeTeam
		if s.isAdmin(ctx, uid) {
			requested = ScopeAll
		}
	}
	scope, allowed := s.resolveScope(ctx, uid, requested)
	if !allowed || scope == ScopeMine {
		failCode(c, 403, "无权查看管理看板")
		return
	}

	now := time.Now()
	today := todayStr(now)
	date := c.Query("date")
	if _, err := time.Parse("2006-01-02", date); err != nil {
		date = today
	}
	month := date[:7]
	department := c.Query("department_id")
	report, err := s.buildAttendanceReport(ctx, uid, scope, month, department, now)
	if err != nil {
		fail(c, "查询出勤统计失败")
		return
	}
	rate, err := s.buildSubmitRate(ctx, uid, scope, date, today, department)
	if err != nil {
		fail(c, "查询日报统计失败")
		return
	}
	_, ids, err := s.attendanceEmployees(ctx, uid, scope, department)
	if err != nil {
		fail(c, "查询部门失败")
		return
	}
	items, err := s.approvalItems(ctx, uid, TabPending, "")
	if err != nil {
		fail(c, "查询待审批失败")
		return
	}
	exceptions, err := s.effectiveReportExceptions(ctx, ids, month, s.approvedLeaveDays(ctx, ids, month))
	if err != nil {
		fail(c, "查询考勤异常失败")
		return
	}
	exceptionCounts := map[string]int{}
	for _, item := range exceptions {
		exceptionCounts[item.Date]++
	}
	trend := []dashboardExceptionDay{}
	first, _ := time.Parse("2006-01", month)
	for day, end := first, first.AddDate(0, 1, 0); day.Before(end); day = day.AddDate(0, 0, 1) {
		dayText := todayStr(day)
		if dayText > today {
			break
		}
		trend = append(trend, dashboardExceptionDay{Date: dayText, Count: exceptionCounts[dayText]})
	}

	ok(c, gin.H{
		"date": date, "month": month, "scope": scope,
		"attendance":  report.Total,
		"reports":     gin.H{"done": rate.Done, "total": rate.Total, "rate": rate.Rate},
		"approvals":   len(filterApprovalItemsForEmployees(items, ids)),
		"exceptions":  report.Total.Exceptions,
		"daily_trend": trend,
	})
}
