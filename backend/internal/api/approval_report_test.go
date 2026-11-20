package api

import (
	"net/url"
	"testing"

	"github.com/xinbo/xinbo-oa/internal/model"
)

func TestApprovalReportLinkLocatesExactReport(t *testing.T) {
	rec := model.ReportRecord{ID: "r/1 & 2", Status: "pending_leader"}
	item := reportApprovalItem(rec, true)
	link, err := url.Parse(item.Path)
	if err != nil || link.Path != "/report-review" || link.Query().Get("report_id") != rec.ID {
		t.Fatalf("invalid report link %q: %v", item.Path, err)
	}
	if !item.CanApprove || item.Status != rec.Status {
		t.Fatalf("wrong approval metadata: %+v", item)
	}
}
