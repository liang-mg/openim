package api

import (
	"testing"

	"github.com/xinbo/xinbo-oa/internal/model"
)

func TestReportReviewActions(t *testing.T) {
	org := reportReviewOrg{
		"employee": {UserID: "employee", ManagerID: "manager"},
		"manager":  {UserID: "manager", ManagerID: "leader", Role: "manager"},
		"leader":   {UserID: "leader", Role: "leader"},
		"admin":    {UserID: "admin", IsAdmin: true},
		"member":   {UserID: "member", ManagerID: "informal"},
		"informal": {UserID: "informal", ManagerID: "admin"},
		"leaf":     {UserID: "leaf", ManagerID: "local"},
		"local":    {UserID: "local", Role: "manager"},
		"isolated": {UserID: "isolated", ManagerID: "disabled"},
		"disabled": {UserID: "disabled", Disabled: true, Role: "leader", ManagerID: "leader"},
		"loop":     {UserID: "loop", ManagerID: "loopboss"},
		"loopboss": {UserID: "loopboss", ManagerID: "loop", Role: "leader"},
	}

	for _, tt := range []struct {
		name, reviewer, author, status string
		want                           reportReviewActions
	}{
		{"employee first stage", "manager", "employee", "submitted", reportReviewActions{CanComment: true, CanEscalate: true}},
		{"leader must wait for first stage", "leader", "employee", "submitted", reportReviewActions{}},
		{"employee final stage", "leader", "employee", "pending_leader", reportReviewActions{CanComment: true, CanArchive: true}},
		{"first stage reviewer cannot finalize escalation", "manager", "employee", "pending_leader", reportReviewActions{}},
		{"leader finalizes direct report", "leader", "manager", "submitted", reportReviewActions{CanComment: true, CanArchive: true}},
		{"employee may supervise", "informal", "member", "submitted", reportReviewActions{CanComment: true, CanEscalate: true}},
		{"admin may finalize within chain", "admin", "member", "pending_leader", reportReviewActions{CanComment: true, CanArchive: true}},
		{"unrelated admin cannot finalize", "admin", "employee", "pending_leader", reportReviewActions{}},
		{"no final reviewer", "local", "leaf", "submitted", reportReviewActions{CanComment: true}},
		{"cannot comment on draft", "manager", "employee", "draft", reportReviewActions{}},
		{"cannot comment on archive", "leader", "manager", "archived", reportReviewActions{}},
		{"cannot comment on own report", "loop", "loop", "submitted", reportReviewActions{}},
		{"cannot review through a cycle", "loopboss", "loop", "submitted", reportReviewActions{}},
		{"disabled supervisor", "disabled", "isolated", "submitted", reportReviewActions{}},
		{"cannot bypass disabled supervisor", "leader", "isolated", "pending_leader", reportReviewActions{}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := org.actions(tt.reviewer, tt.author, tt.status); got != tt.want {
				t.Fatalf("actions = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestReportReviewDetailVisibility(t *testing.T) {
	org := reportReviewOrg{
		"employee": {UserID: "employee", ManagerID: "manager"},
		"manager":  {UserID: "manager", ManagerID: "leader", Role: "manager"},
		"leader":   {UserID: "leader", Role: "leader"},
		"outside":  {UserID: "outside", Role: "leader"},
	}
	rec := model.ReportRecord{
		Author:  model.ReportAuthor{UserID: "employee"},
		Status:  "archived",
		Reviews: []model.ReviewInfo{{ReviewerID: "manager"}},
	}
	for _, uid := range []string{"employee", "manager", "leader"} {
		if !org.canReadReport(uid, rec) {
			t.Errorf("%s cannot read report", uid)
		}
	}
	if org.canReadReport("outside", rec) {
		t.Error("unrelated leader can read report")
	}
	rec.Status = "draft"
	if org.canReadReport("manager", rec) {
		t.Error("previous reviewer can view the author's draft")
	}
}
