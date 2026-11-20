package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v4"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"

	"github.com/xinbo/xinbo-oa/internal/config"
	"github.com/xinbo/xinbo-oa/internal/model"
	"github.com/xinbo/xinbo-oa/internal/store"
)

func TestAttendanceRulesAndReportHTTP(t *testing.T) {
	uri := os.Getenv("OA_ATTENDANCE_TEST_MONGO_URI")
	if uri == "" {
		t.Skip("requires isolated MongoDB; set OA_ATTENDANCE_TEST_MONGO_URI")
	}
	ctx := context.Background()
	company := primitive.NewObjectID().Hex()
	cfg := &config.Config{CompanyID: company, Secret: "local-attendance-workflow-fixture", MakeupMaxDays: 7, MakeupMaxMonth: 3}
	st, err := store.Connect(uri, "oa_attendance_test_"+company)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := st.DB.Drop(ctx); err != nil {
			t.Error(err)
		}
		if err := st.Client.Disconnect(ctx); err != nil {
			t.Error(err)
		}
	})
	if err := st.EnsureIndexes(ctx); err != nil {
		t.Fatal(err)
	}
	s := NewServer(st, cfg, nil)
	router := s.Router()
	call := func(method, path, userID, body string) (int, json.RawMessage) {
		t.Helper()
		request := httptest.NewRequest(method, "/oa/api/v1"+path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"UserID": userID}).SignedString([]byte(cfg.Secret))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("token", token)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		var result struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatalf("%s %s: %s", method, path, response.Body.String())
		}
		return result.Code, result.Data
	}

	for _, id := range []string{"sales", "other"} {
		if _, err := st.Departments().InsertOne(ctx, model.Department{CompanyID: company, ID: id, Name: id}); err != nil {
			t.Fatal(err)
		}
	}
	for _, employee := range []model.Employee{
		{UserID: "admin", IsAdmin: true},
		{UserID: "leader", Role: "leader"},
		{UserID: "manager", Role: "manager", ManagerID: "leader"},
		{UserID: "sales-user", ManagerID: "manager", DepartmentID: "sales"},
		{UserID: "other-user", DepartmentID: "other"},
	} {
		employee.CompanyID, employee.RealName = company, employee.UserID
		if _, err := st.Employees().InsertOne(ctx, employee); err != nil {
			t.Fatal(err)
		}
	}
	const rule = `{"work_on_time":"09:00","work_off_time":"18:00","earliest_on":"00:00","workdays":[0,1,2,3,4,5,6],`
	makeup := func(user string, daysAgo int) int {
		t.Helper()
		date := todayStr(time.Now().AddDate(0, 0, -daysAgo))
		code, _ := call(http.MethodPost, "/makeup/submit", user,
			`{"date":"`+date+`","type":"on","time":"09:00","reason":"核对补卡日期规则"}`)
		return code
	}
	if code := makeup("sales-user", 8); code == 0 {
		t.Fatal("default rule permitted a date over seven days old")
	}
	if code := makeup("sales-user", 7); code != 0 {
		t.Fatalf("default rule rejected the seventh day: %d", code)
	}
	if code, data := call(http.MethodPost, "/attendance/rule", "admin", rule+`"need_photo":false,"need_location":true}`); code != 0 {
		t.Fatalf("company rule save failed: %d %s", code, data)
	}
	if code, data := call(http.MethodPost, "/attendance/rule", "admin", rule+`"department_id":"sales","need_photo":false,"need_location":false,"makeup_max_days":14}`); code != 0 {
		t.Fatalf("department rule save failed: %d %s", code, data)
	}
	if code := makeup("sales-user", 10); code != 0 {
		t.Fatalf("department rule rejected an eligible date older than seven days: %d", code)
	}
	if code := makeup("sales-user", 15); code == 0 {
		t.Fatal("department rule permitted a date over fourteen days old")
	}
	if code, _ := call(http.MethodPost, "/checkin/submit", "other-user", `{"type":"on"}`); code == 0 {
		t.Fatal("company location requirement bypassed")
	}
	code, data := call(http.MethodPost, "/checkin/submit", "sales-user", `{"type":"on"}`)
	var checkin model.CheckinRecord
	if err := json.Unmarshal(data, &checkin); code != 0 || err != nil ||
		checkin.RuleSnapshot == nil || checkin.RuleSnapshot.DepartmentID != "sales" || checkin.FenceSet {
		t.Fatalf("optional checkin or snapshot failed: %d %s %v", code, data, err)
	}
	if code, _ := call(http.MethodPost, "/attendance/rule", "admin", rule+
		`"department_id":"sales","office":{"configured":true,"lat":31,"lng":121,"strict":true,"radius":50}}`); code != 0 {
		t.Fatalf("fence rule save failed: %d", code)
	}
	if code := makeup("sales-user", 30); code != 0 {
		t.Fatalf("unlimited department rule rejected an old date: %d", code)
	}
	if code, _ := call(http.MethodPost, "/checkin/submit", "sales-user", `{"type":"off","lat":32,"lng":121}`); code == 0 {
		t.Fatal("strict fence allowed an out-of-range checkin")
	}
	date := todayStr(time.Now())
	month := date[:7]
	if _, err := st.Makeups().InsertOne(ctx, model.MakeupRequest{
		ID: "approved-makeup", CompanyID: company, UserID: "sales-user", Date: date, Type: "off",
		Status: "approved", CheckinID: "makeup-off",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Checkins().InsertOne(ctx, model.CheckinRecord{
		ID: "makeup-off", CompanyID: company, UserID: "sales-user", Date: date, Type: "off",
		Source: "makeup", MakeupID: "approved-makeup", Status: "normal", CheckinTime: time.Now().UnixMilli(),
	}); err != nil {
		t.Fatal(err)
	}
	for _, item := range []model.CheckinException{
		{ID: "open", Status: "open", Kind: model.ExcLate},
		{ID: "ignored", Status: "ignored", Kind: model.ExcEarly},
	} {
		item.CompanyID, item.UserID, item.Date = company, "sales-user", date
		if _, err := st.Exceptions().InsertOne(ctx, item); err != nil {
			t.Fatal(err)
		}
	}
	path := "/checkin/report?scope=team&month=" + month + "&department_id="
	compare := func(user, dept string, rows, makeup, exceptions int) {
		t.Helper()
		code, data := call(http.MethodGet, path+dept, user, "")
		var report model.AttendanceReport
		if err := json.Unmarshal(data, &report); code != 0 || err != nil ||
			len(report.Rows) != rows || report.Total.Makeup != makeup || report.Total.Exceptions != exceptions {
			t.Fatalf("report mismatch: %d %s %v", code, data, err)
		}
	}
	compare("manager", "sales", 1, 1, 1)
	compare("manager", "other", 0, 0, 0)
	if code, data := call(http.MethodGet, "/checkin/exception/list?scope=team&month="+month, "leader", ""); code != 0 {
		t.Fatalf("leader could not read exception summary: %d", code)
	} else {
		var summary model.ExceptionListResult
		if err := json.Unmarshal(data, &summary); err != nil || summary.Total != 2 || len(summary.List) != 0 {
			t.Fatalf("leader summary should have counts but no employee records: %s, %v", data, err)
		}
	}
	if code, _ := call(http.MethodPost, "/checkin/exception/handle", "leader",
		`{"exception_id":"open","action":"ignore","comment":"核对"}`); code != 403 {
		t.Fatalf("leader processed individual exception: %d", code)
	}
	if code, _ := call(http.MethodPost, "/checkin/exception/handle", "manager",
		`{"exception_id":"open","action":"ignore","comment":"核对"}`); code != 0 {
		t.Fatalf("assigned manager failed to process exception: %d", code)
	}
	compare("manager", "sales", 1, 1, 0)
	if _, err := st.Reports().InsertOne(ctx, model.ReportRecord{
		ID: "submitted-report", CompanyID: company, Author: model.ReportAuthor{UserID: "sales-user"},
		Period: date, Type: "daily", Status: "submitted",
	}); err != nil {
		t.Fatal(err)
	}
	dashboardPath := "/management/dashboard?scope=team&department_id=sales&date=" + date
	if code, _ := call(http.MethodGet, dashboardPath, "sales-user", ""); code != 403 {
		t.Fatalf("ordinary employee can access management dashboard: %d", code)
	}
	code, data = call(http.MethodGet, dashboardPath, "manager", "")
	var dashboard struct {
		Attendance model.ReportRow         `json:"attendance"`
		Reports    model.SubmitRateResult  `json:"reports"`
		Approvals  int                     `json:"approvals"`
		Exceptions int                     `json:"exceptions"`
		Trend      []dashboardExceptionDay `json:"daily_trend"`
	}
	if err := json.Unmarshal(data, &dashboard); code != 0 || err != nil ||
		dashboard.Attendance.Makeup != 1 || dashboard.Reports.Total != 1 || dashboard.Reports.Done != 1 ||
		dashboard.Approvals != 4 || dashboard.Exceptions != 0 || len(dashboard.Trend) == 0 {
		t.Fatalf("dashboard metrics do not match scoped reports: %d %s %v", code, data, err)
	}

	// Simulate approval after the scan's first read and before its missing-card upsert.
	employee := s.getEmployee(ctx, "sales-user")
	initial, err := s.loadApprovedLeaveDays(ctx, []string{employee.UserID}, month)
	if err != nil || initial[employee.UserID][date] {
		t.Fatalf("unexpected initial leave: %v %v", initial, err)
	}
	if _, err := st.Leaves().InsertOne(ctx, model.LeaveRequest{
		ID: "approved-leave", CompanyID: company, UserID: employee.UserID, StartDate: date, EndDate: date,
		Status: "approved", WorkDates: []string{date},
	}); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{model.ExcAbsent, model.ExcOutsideFence} {
		if _, err := s.upsertException(ctx, *employee, date, kind, "测试待办", ""); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.reconcileScannedLeave(ctx, month, map[string]map[string]bool{employee.UserID: {date: true}}); err != nil {
		t.Fatal(err)
	}
	assertException := func(kind, status string) {
		t.Helper()
		var rec model.CheckinException
		err := st.Exceptions().FindOne(ctx, bson.M{"company_id": company, "user_id": employee.UserID, "date": date, "kind": kind}).Decode(&rec)
		if err != nil || rec.Status != status {
			t.Fatalf("exception %s status %s, want %s: %v", kind, rec.Status, status, err)
		}
	}
	assertException(model.ExcAbsent, "resolved")
	assertException(model.ExcOutsideFence, "open")

	if _, err := s.upsertException(ctx, *employee, date, model.ExcMissingOff, "测试陈旧待办", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.scanExceptionsFor(ctx, []string{employee.UserID}, date, date); err != nil {
		t.Fatal(err)
	}
	assertException(model.ExcMissingOff, "resolved")
	assertException(model.ExcOutsideFence, "open")

	for _, calendar := range []struct{ user, path string }{
		{employee.UserID, "/checkin/list?month=" + month},
		{"manager", "/checkin/team/" + employee.UserID + "?month=" + month},
	} {
		code, data := call(http.MethodGet, calendar.path, calendar.user, "")
		var result struct {
			Days map[string]bool `json:"approved_leave_days"`
		}
		if err := json.Unmarshal(data, &result); code != 0 || err != nil || !result.Days[date] {
			t.Fatalf("approved leave missing for %s: %d %s %v", calendar.path, code, data, err)
		}
	}
}
