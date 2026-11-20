package api

import (
	"testing"

	"github.com/xinbo/xinbo-oa/internal/model"
)

func TestAttendanceTimelineUsesDepartmentAndKeepsPriorWorkdays(t *testing.T) {
	timeline := ruleTimeline{
		legacy: model.AttendanceRule{WorkOnTime: "09:00"},
		revisions: map[string][]model.AttendanceRule{
			"":     {{EffectiveDate: "2026-11-10", WorkOnTime: "09:30", Workdays: []int{1, 2, 3, 4, 5, 6}}},
			"dept": {{EffectiveDate: "2026-11-18", WorkOnTime: "10:00", Workdays: []int{0, 1, 2, 3}}},
		},
	}
	for _, tc := range []struct {
		dept, date, start string
		workday           bool
	}{
		{"dept", "2026-11-07", "09:00", false},
		{"dept", "2026-11-14", "09:30", true},
		{"dept", "2026-11-21", "10:00", false},
		{"dept", "2026-11-22", "10:00", true},
		{"other", "2026-11-21", "09:30", true},
	} {
		got := timeline.forDay(tc.dept, tc.date)
		if got.WorkOnTime != tc.start || isWorkday(tc.date, got.Workdays) != tc.workday {
			t.Errorf("%s %s got %+v", tc.dept, tc.date, got)
		}
	}
}

func TestAttendanceMonthUsesRuleSnapshotAndSavedStatus(t *testing.T) {
	const date = "2026-11-14" // Saturday
	days := map[string]*dayPair{
		date: {On: &model.CheckinRecord{Status: "late", RuleSnapshot: &model.AttendanceRule{
			Workdays: []int{6}, WorkOffTime: "16:00",
		}}},
	}
	s := &Server{}
	stat := s.monthStatOf(days, nil, "2026-11", date, 17*60, func(day string) model.CheckinRule {
		return model.CheckinRule{WorkOffTime: "18:00", Workdays: []int{1, 2, 3, 4, 5}}
	})
	if stat.Attend != 1 || stat.Late != 1 || stat.Partial != 1 {
		t.Fatalf("snapshot or saved status ignored: %+v", stat)
	}
}
