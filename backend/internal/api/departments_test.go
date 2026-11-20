package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v4"
	"go.mongodb.org/mongo-driver/bson/primitive"

	"github.com/xinbo/xinbo-oa/internal/config"
	"github.com/xinbo/xinbo-oa/internal/model"
	"github.com/xinbo/xinbo-oa/internal/store"
)

func TestDepartmentManagementAndRequestRouting(t *testing.T) {
	mongoURI := os.Getenv("OA_DEPARTMENT_TEST_MONGO_URI")
	if mongoURI == "" {
		t.Skip("requires isolated MongoDB; set OA_DEPARTMENT_TEST_MONGO_URI")
	}
	ctx := context.Background()
	cfg := &config.Config{CompanyID: primitive.NewObjectID().Hex(), Secret: "department-workflow-test"}
	st, err := store.Connect(mongoURI, "oa_department_test_"+cfg.CompanyID)
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
	for _, e := range []model.Employee{
		{UserID: "admin", Role: "employee", IsAdmin: true, Department: "其他"},
		{UserID: "employee", Role: "employee", Department: "旧技术组", ManagerID: "manager"},
		{UserID: "no-manager", Role: "employee", Department: "旧技术组"},
		{UserID: "legacy", Role: "employee", Department: "旧技术组二"},
		{UserID: "head", Role: "employee", Department: "其他"},
		{UserID: "manager", Role: "manager", Department: "其他"},
	} {
		e.CompanyID, e.RealName = cfg.CompanyID, e.UserID
		if _, err := st.Employees().InsertOne(ctx, e); err != nil {
			t.Fatal(err)
		}
	}

	call := func(method, path, userID, body string) (int, json.RawMessage) {
		t.Helper()
		req := httptest.NewRequest(method, "/oa/api/v1"+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"UserID": userID}).SignedString([]byte(cfg.Secret))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("token", token)
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		var result struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(out.Body.Bytes(), &result); err != nil {
			t.Fatalf("%s %s failed with HTTP %d: %s", method, path, out.Code, out.Body.String())
		}
		return result.Code, result.Data
	}
	saveDepartment := func(body string) model.Department {
		t.Helper()
		code, data := call(http.MethodPost, "/admin/department/save", "admin", body)
		var department model.Department
		if err := json.Unmarshal(data, &department); code != 0 || err != nil || department.ID == "" {
			t.Fatalf("department save failed: code %d data %s err %v", code, data, err)
		}
		return department
	}
	if code, _ := call(http.MethodGet, "/admin/departments", "employee", ""); code != 403 {
		t.Errorf("regular employee read admin department list: %d", code)
	}
	root := saveDepartment(`{"name":"技术部"}`)
	child := saveDepartment(`{"name":"平台组","parent_id":"` + root.ID + `","head_id":"head"}`)
	otherRoot := saveDepartment(`{"name":"其他部门"}`)
	if code, _ := call(http.MethodPost, "/admin/department/save", "admin", `{"name":"三级","parent_id":"`+child.ID+`"}`); code == 0 {
		t.Error("created a third department level")
	}
	if code, _ := call(http.MethodPost, "/admin/department/save", "admin", `{"name":"平台组","parent_id":"`+root.ID+`"}`); code == 0 {
		t.Error("created an ambiguous duplicate sibling")
	}
	if code, _ := call(http.MethodPost, "/admin/department/migrate", "admin", `{"legacy_name":"旧技术组","department_id":"`+child.ID+`"}`); code != 0 {
		t.Fatalf("explicit department migration failed: %d", code)
	}
	for _, uid := range []string{"employee", "no-manager"} {
		if e := s.getEmployee(ctx, uid); e == nil || e.DepartmentID != child.ID || e.Department != "平台组" {
			t.Errorf("employee %s did not receive the confirmed mapping: %+v", uid, e)
		}
	}
	if e := s.getEmployee(ctx, "legacy"); e == nil || e.DepartmentID != "" || e.Department != "旧技术组二" {
		t.Errorf("unmatched legacy name was modified: %+v", e)
	}

	submit := func(uid, date string) model.LeaveRequest {
		t.Helper()
		code, data := call(http.MethodPost, "/leave/submit", uid, `{"type":"sick","start_date":"`+date+`","end_date":"`+date+`","reason":"fixture"}`)
		var leave model.LeaveRequest
		if err := json.Unmarshal(data, &leave); code != 0 || err != nil || leave.ID == "" {
			t.Fatalf("submit failed: code %d data %s err %v", code, data, err)
		}
		return leave
	}
	direct := submit("employee", "2026-11-20")
	fallback := submit("no-manager", "2026-11-20")
	if direct.ApproverID != "manager" || fallback.ApproverID != "head" {
		t.Errorf("wrong approvers: direct=%q, fallback=%q", direct.ApproverID, fallback.ApproverID)
	}
	code, _ := call(http.MethodPost, "/admin/employee/save", "admin", `{"user_id":"no-manager","real_name":"no-manager","role":"employee","department_id":"`+otherRoot.ID+`"}`)
	if code != 0 {
		t.Fatalf("employee reassignment failed: %d", code)
	}
	saveDepartment(`{"department_id":"` + child.ID + `","head_id":"manager"}`)
	newRequest := submit("no-manager", "2026-11-23")
	if newRequest.ApproverID != "" {
		t.Errorf("new request kept former department head: %+v", newRequest)
	}
	code, data := call(http.MethodGet, "/leave/list?scope=assigned", "head", "")
	if code != 0 || !strings.Contains(string(data), fallback.ID) || strings.Contains(string(data), direct.ID) || strings.Contains(string(data), newRequest.ID) {
		t.Errorf("assignment scope lost pending item or exposed another request: code %d data %s", code, data)
	}
	code, data = call(http.MethodGet, "/me", "head", "")
	var head model.Employee
	if err := json.Unmarshal(data, &head); code != 0 || err != nil || head.CanViewTeam || !head.CanReviewAttendance {
		t.Errorf("former head lost review access or gained team access: code %d data %s", code, data)
	}
	code, data = call(http.MethodGet, "/organization/departments?scope=team", "manager", "")
	if code != 0 || !strings.Contains(string(data), root.ID) || !strings.Contains(string(data), child.ID) ||
		strings.Contains(string(data), otherRoot.ID) || strings.Contains(string(data), "head_id") {
		t.Errorf("department options did not match manager scope: code %d data %s", code, data)
	}
	if code, _ := call(http.MethodGet, "/checkin/team?scope=team", "head", ""); code != 403 {
		t.Errorf("request assignment unexpectedly granted team attendance access: %d", code)
	}
	if code, _ := call(http.MethodGet, "/organization/departments?scope=team", "head", ""); code != 403 {
		t.Errorf("request assignment unexpectedly granted team department access: %d", code)
	}
	if code, _ := call(http.MethodPost, "/leave/approve", "head", `{"leave_id":"`+fallback.ID+`","action":"approve","comment":"approved"}`); code != 0 {
		t.Errorf("former department head could not finish an assigned request: %d", code)
	}
}
