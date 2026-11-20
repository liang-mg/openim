package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v4"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/event"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/xinbo/xinbo-oa/internal/config"
	"github.com/xinbo/xinbo-oa/internal/model"
	"github.com/xinbo/xinbo-oa/internal/store"
)

func TestOperationAuditWorkflow(t *testing.T) {
	mongoURI := os.Getenv("OA_AUDIT_TEST_MONGO_URI")
	if mongoURI == "" {
		t.Skip("requires isolated MongoDB; set OA_AUDIT_TEST_MONGO_URI")
	}
	ctx := context.Background()
	cfg := &config.Config{CompanyID: primitive.NewObjectID().Hex(), Secret: "operation-audit-test"}
	firstPosition, secondPosition := "concurrent-position-first", "concurrent-position-second"
	reachedWrite := make(chan string, 2)
	releaseWrite := map[string]chan struct{}{
		firstPosition: make(chan struct{}), secondPosition: make(chan struct{}),
	}
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(mongoURI).SetMonitor(&event.CommandMonitor{
		Started: func(ctx context.Context, evt *event.CommandStartedEvent) {
			if evt.CommandName != "findAndModify" && evt.CommandName != "update" {
				return
			}
			for position, release := range releaseWrite {
				if strings.Contains(evt.Command.String(), position) {
					reachedWrite <- position
					select {
					case <-release:
					case <-ctx.Done():
					}
				}
			}
		},
	}))
	if err != nil {
		t.Fatal(err)
	}
	st := &store.Store{Client: client, DB: client.Database("oa_audit_test_" + cfg.CompanyID)}
	t.Cleanup(func() {
		if err := st.DB.Drop(ctx); err != nil {
			t.Error(err)
		}
		if err := st.Client.Disconnect(ctx); err != nil {
			t.Error(err)
		}
	})
	s := NewServer(st, cfg, nil)
	router := s.Router()
	for _, e := range []model.Employee{
		{UserID: "hr", Role: "hr"},
		{UserID: "manager", Role: "manager"},
		{UserID: "employee", Role: "employee", ManagerID: "manager", Position: "旧岗位"},
		{UserID: "unrelated", Role: "employee"},
	} {
		e.CompanyID, e.RealName, e.Department = cfg.CompanyID, e.UserID, "测试组"
		if _, err := st.Employees().InsertOne(ctx, e); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := st.Reports().InsertOne(ctx, model.ReportRecord{
		ID: "r_1795000000000", CompanyID: cfg.CompanyID, Status: "submitted",
		Author:  model.ReportAuthor{UserID: "employee"},
		Content: model.ReportContent{Done: "private report text"},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Makeups().InsertOne(ctx, model.MakeupRequest{
		ID: "makeup-fixture", CompanyID: cfg.CompanyID, UserID: "employee",
		ApproverID: "manager", Status: "pending", Date: "2026-11-20", Type: "on", Time: "08:50",
	}); err != nil {
		t.Fatal(err)
	}

	call := func(method, path, uid, body string) (int, json.RawMessage) {
		t.Helper()
		req := httptest.NewRequest(method, "/oa/api/v1"+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"UserID": uid}).SignedString([]byte(cfg.Secret))
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
	if code, _ := call(http.MethodPost, "/admin/employee/save", "hr", `{"user_id":"employee","real_name":"employee","department":"测试组","position":"新岗位","role":"employee","manager_id":"manager"}`); code != 0 {
		t.Fatalf("employee update failed: %d", code)
	}
	if code, _ := call(http.MethodPost, "/makeup/approve", "manager", `{"makeup_id":"makeup-fixture","action":"approve","comment":"private approval text"}`); code != 0 {
		t.Fatalf("makeup approval failed: %d", code)
	}
	if code, _ := call(http.MethodGet, "/report/all-for-review?report_id=r_1795000000000", "manager", ""); code != 0 {
		t.Fatalf("report read failed: %d", code)
	}
	if code, _ := call(http.MethodGet, "/report/all-for-review?report_id=r_1795000000000", "unrelated", ""); code == 0 {
		t.Errorf("employee got access to a submitted report outside review scope")
	}
	if code, _ := call(http.MethodGet, "/admin/audit", "employee", ""); code != 403 {
		t.Errorf("employee got access to the audit log: %d", code)
	}
	if code, _ := call(http.MethodGet, "/admin/audit", "manager", ""); code != 403 {
		t.Errorf("manager got access to the audit log: %d", code)
	}
	code, data := call(http.MethodGet, "/admin/audit", "hr", "")
	for _, required := range []string{"employee_update", "checkin_correct", "report_read", "r_1795000000000", "旧岗位", "新岗位", "2026-11-20", "08:50", "success"} {
		if code != 0 || !strings.Contains(string(data), required) {
			t.Errorf("missing %q in audit response %d/%s", required, code, data)
		}
	}
	if strings.Contains(string(data), "private") {
		t.Errorf("audit exposed business content: %s", data)
	}
	code, data = call(http.MethodGet, "/admin/audit?actor_id=manager&action=report_read", "hr", "")
	if code != 0 || !strings.Contains(string(data), "r_1795000000000") ||
		strings.Contains(string(data), "makeup-fixture") || strings.Contains(string(data), "新岗位") {
		t.Errorf("audit filter failed: %d/%s", code, data)
	}
	date := todayStr(time.Now())
	code, data = call(http.MethodGet, "/admin/audit?from="+date+"&to="+date+"&action=report_read&actor_id=unrelated", "hr", "")
	if code != 0 || !strings.Contains(string(data), "r_1795000000000") || !strings.Contains(string(data), "denied") {
		t.Errorf("audit did not return denial within the requested date window: %d/%s", code, data)
	}

	// Hold both writes after their preceding reads, then release them in sequence.
	t.Run("concurrent update logs the actual previous record", func(t *testing.T) {
		start := func(position string) <-chan int {
			result := make(chan int, 1)
			go func() {
				body := fmt.Sprintf(`{"user_id":"employee","real_name":"employee","department":"测试组","position":%q,"role":"employee","manager_id":"manager"}`, position)
				code, _ := call(http.MethodPost, "/admin/employee/save", "hr", body)
				result <- code
			}()
			select {
			case actual := <-reachedWrite:
				if actual != position {
					t.Fatalf("held %s, expected %s", actual, position)
				}
			case <-time.After(3 * time.Second):
				t.Fatalf("save of %s did not reach MongoDB", position)
			}
			return result
		}
		first, second := start(firstPosition), start(secondPosition)
		defer func() {
			if len(reachedWrite) > 0 {
				t.Error("more than two concurrent writes were issued")
			}
		}()
		close(releaseWrite[firstPosition])
		if code := <-first; code != 0 {
			t.Fatalf("first save failed: %d", code)
		}
		close(releaseWrite[secondPosition])
		if code := <-second; code != 0 {
			t.Fatalf("second save failed: %d", code)
		}
		var saved model.OperationAudit
		err := st.OperationsAudit().FindOne(ctx, bson.M{
			"company_id": cfg.CompanyID, "action": auditEmployeeUpdate,
			"changes": bson.M{"$elemMatch": bson.M{"field": "position", "after": secondPosition}},
		}).Decode(&saved)
		if err != nil {
			t.Fatal(err)
		}
		for _, change := range saved.Changes {
			if change.Field == "position" && change.Before != firstPosition {
				t.Fatalf("second save logged a stale previous position: %+v", change)
			}
		}
	})
}
