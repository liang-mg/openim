package api

import (
	"context"
	"log"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/xinbo/xinbo-oa/internal/model"
)

func (s *Server) runCheckinReminders() {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	records, err := s.storeCheckinReminders(ctx, time.Now())
	if err != nil {
		log.Printf("[notify] check-in reminders: %v", err)
	}
	s.finishNotifications(records)
}

func (s *Server) storeCheckinReminders(ctx context.Context, now time.Time) ([]model.Notification, error) {
	date := todayStr(now)
	timeline, err := s.attendanceRuleTimeline(ctx)
	if err != nil {
		return nil, err
	}
	employeeCursor, err := s.Store.Employees().Find(ctx, bson.M{
		"company_id": s.Cfg.CompanyID, "disabled": bson.M{"$ne": true},
	})
	if err != nil {
		return nil, err
	}
	var employees []model.Employee
	if err := employeeCursor.All(ctx, &employees); err != nil || len(employees) == 0 {
		return nil, err
	}

	checkins, err := s.loadVisibleCheckins(ctx, bson.M{"company_id": s.Cfg.CompanyID, "date": date},
		options.Find().SetProjection(bson.M{
			"user_id": 1, "date": 1, "type": 1, "source": 1, "checkin_id": 1, "makeup_id": 1,
		}))
	if err != nil {
		return nil, err
	}
	arrivals, departures := make(map[string]bool), make(map[string]bool)
	for _, checkin := range checkins {
		switch checkin.Type {
		case "on":
			arrivals[checkin.UserID] = true
		case "off":
			departures[checkin.UserID] = true
		}
	}

	leaveCursor, err := s.Store.Leaves().Find(ctx, bson.M{
		"company_id": s.Cfg.CompanyID, "status": "approved",
		"start_date": bson.M{"$lte": date}, "end_date": bson.M{"$gte": date},
	})
	if err != nil {
		return nil, err
	}
	var leaves []model.LeaveRequest
	if err := leaveCursor.All(ctx, &leaves); err != nil {
		return nil, err
	}
	approvedLeave := make(map[string]bool, len(leaves))
	for _, leave := range leaves {
		for _, leaveDate := range leaveWorkdays(leave) {
			if leaveDate == date {
				approvedLeave[leave.UserID] = true
				break
			}
		}
	}

	var records []model.Notification
	for _, employee := range employees {
		if approvedLeave[employee.UserID] {
			continue
		}
		rule := timeline.forDay(employee.DepartmentID, date)
		shift := missingCheckinShift(now, rule, arrivals[employee.UserID], departures[employee.UserID])
		if shift == "" {
			continue
		}
		content := "今天还没有上班打卡，请记得打卡。"
		if shift == "off" {
			content = "今天还没有下班打卡，请记得打卡。"
		}
		record, err := s.storeNotification(ctx, employee.UserID, "checkin_reminder", date+":"+shift,
			"打卡提醒", content, "/checkin")
		if err != nil {
			continue
		}
		if record.ID != "" {
			records = append(records, record)
		}
	}
	return records, nil
}

func missingCheckinShift(now time.Time, rule model.AttendanceRule, hasOn, hasOff bool) string {
	if !isWorkday(todayStr(now), rule.Workdays) || hasOff {
		return ""
	}
	minute := minuteOfDay(now)
	if !hasOn && minute >= parseHM(rule.WorkOnTime)+rule.LateGrace {
		return "on"
	}
	if hasOn && minute >= parseHM(rule.WorkOffTime) {
		return "off"
	}
	return ""
}
