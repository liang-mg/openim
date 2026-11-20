package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/golang-jwt/jwt/v4"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"

	"github.com/xinbo/xinbo-oa/internal/config"
	"github.com/xinbo/xinbo-oa/internal/model"
	"github.com/xinbo/xinbo-oa/internal/store"
)

func TestMakeupApprovalResumesWithoutExposingUnconfirmedCheckin(t *testing.T) {
	mongoURI := os.Getenv("OA_AUDIT_TEST_MONGO_URI")
	if mongoURI == "" {
		t.Skip("requires isolated MongoDB; set OA_AUDIT_TEST_MONGO_URI")
	}
	ctx := context.Background()
	cfg := &config.Config{CompanyID: primitive.NewObjectID().Hex(), Secret: "makeup-approval-test"}
	st, err := store.Connect(mongoURI, "oa_makeup_test_"+cfg.CompanyID)
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
		{UserID: "employee", ManagerID: "reviewer"},
		{UserID: "reviewer", Role: "manager"},
	} {
		e.CompanyID, e.RealName = cfg.CompanyID, e.UserID
		if _, err := st.Employees().InsertOne(ctx, e); err != nil {
			t.Fatal(err)
		}
	}
	type response struct {
		Code int `json:"code"`
		Data struct {
			Status    string `json:"status"`
			CheckinID string `json:"checkin_id"`
		} `json:"data"`
	}
	request := func(uid, path, body string) response {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/oa/api/v1"+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"UserID": uid}).SignedString([]byte(cfg.Secret))
		if err != nil {
			t.Error(err)
			return response{Code: -1}
		}
		req.Header.Set("token", token)
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		var result response
		if err := json.Unmarshal(out.Body.Bytes(), &result); err != nil {
			t.Errorf("unexpected admin response: HTTP %d %s", out.Code, out.Body.String())
			return response{Code: -1}
		}
		return result
	}
	approve := func(id, action string) response {
		return request("reviewer", "/makeup/approve", `{"makeup_id":"`+id+`","action":"`+action+`","comment":"new comment"}`)
	}
	cancel := func(id string) response {
		return request("employee", "/makeup/cancel", `{"makeup_id":"`+id+`"}`)
	}
	seed := func(id, date string, occupied *model.CheckinRecord) {
		t.Helper()
		card := model.CheckinRecord{
			ID: id + "-checkin", CompanyID: cfg.CompanyID, UserID: "employee", Date: date,
			Type: "on", Source: "makeup", MakeupID: id, Status: "normal",
		}
		if _, err := st.Makeups().InsertOne(ctx, bson.M{
			"company_id": cfg.CompanyID, "makeup_id": id, "user_id": "employee",
			"approver_id": "reviewer", "status": "pending", "date": date, "type": "on", "time": "08:50",
			"approval_claim": bson.M{
				"actor_id": "reviewer", "actor_name": "reviewer", "comment": "original approval comment",
				"checkin": card, "claimed_at": int64(1795158291904),
			},
		}); err != nil {
			t.Fatal(err)
		}
		if occupied == nil {
			occupied = &card
		}
		if _, err := st.Checkins().InsertOne(ctx, occupied); err != nil {
			t.Fatal(err)
		}
	}
	seed("interrupted", "2026-11-20", nil)
	month, err := s.loadMonth(ctx, []string{"employee"}, "2026-11")
	if err != nil || month["employee"]["2026-11-20"] != nil {
		t.Errorf("unconfirmed checkin leaked into the monthly view: %v %v", month, err)
	}
	var reject, cancellation response
	var contenders sync.WaitGroup
	contenders.Add(2)
	go func() { defer contenders.Done(); reject = approve("interrupted", "reject") }()
	go func() { defer contenders.Done(); cancellation = cancel("interrupted") }()
	contenders.Wait()
	if reject.Code == 0 || cancellation.Code == 0 {
		t.Errorf("a claimed approval could be rejected or cancelled: %+v %+v", reject, cancellation)
	}
	var resumed [2]response
	for i := range resumed {
		contenders.Add(1)
		go func(index int) {
			defer contenders.Done()
			resumed[index] = approve("interrupted", "approve")
		}(i)
	}
	contenders.Wait()
	for _, result := range resumed {
		if result.Code != 0 || result.Data.Status != "approved" || result.Data.CheckinID != "interrupted-checkin" {
			t.Errorf("approval retry changed the checkin identity or failed: %+v", result)
		}
	}
	var final model.MakeupRequest
	if err := st.Makeups().FindOne(ctx, bson.M{"company_id": cfg.CompanyID, "makeup_id": "interrupted"}).Decode(&final); err != nil ||
		final.Comment != "original approval comment" {
		t.Errorf("approval comment changed during retry: %+v %v", final, err)
	}
	month, err = s.loadMonth(ctx, []string{"employee"}, "2026-11")
	if pair := month["employee"]["2026-11-20"]; err != nil || pair == nil || pair.On == nil || pair.On.ID != "interrupted-checkin" {
		t.Errorf("confirmed checkin did not become visible: %v %v", month, err)
	}
	slotCount, err := st.Checkins().CountDocuments(ctx, bson.M{"company_id": cfg.CompanyID, "date": "2026-11-20"})
	if err != nil || slotCount != 1 {
		t.Errorf("concurrent retries duplicated a card: %d %v", slotCount, err)
	}

	seed("regular-wins", "2026-11-23", &model.CheckinRecord{
		ID: "regular", CompanyID: cfg.CompanyID, UserID: "employee", Date: "2026-11-23", Type: "on", Source: "normal",
	})
	if result := approve("regular-wins", "approve"); result.Code == 0 {
		t.Error("approval overrode the employee’s regular checkin")
	}
	if err := st.Checkins().FindOne(ctx, bson.M{"company_id": cfg.CompanyID, "checkin_id": "regular"}).Err(); err != nil {
		t.Fatalf("employee’s regular checkin disappeared: %v", err)
	}
	if result := cancel("regular-wins"); result.Code != 0 {
		t.Errorf("conflicting checkin left the request stuck instead of releasing the approval claim: %+v", result)
	}

	seed("startup-recovery", "2026-11-24", nil)
	s.runPendingMakeupApprovals()
	if result := approve("startup-recovery", "approve"); result.Code != 0 ||
		result.Data.CheckinID != "startup-recovery-checkin" {
		t.Errorf("background job did not recover the original checkin: %+v", result)
	}
	auditCount, err := st.OperationsAudit().CountDocuments(ctx, bson.M{
		"company_id": cfg.CompanyID, "action": auditCheckinCorrect,
		"target_id": "interrupted-checkin", "result": auditResultSuccess,
	})
	if err != nil || auditCount != 1 {
		t.Errorf("concurrent retries produced %d completion audit events: %v", auditCount, err)
	}
}
