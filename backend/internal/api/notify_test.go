package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v4"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"

	"github.com/xinbo/xinbo-oa/internal/config"
	"github.com/xinbo/xinbo-oa/internal/model"
	"github.com/xinbo/xinbo-oa/internal/store"
)

func TestPushIMTreatsRedirectAsFailure(t *testing.T) {
	webhook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/redirect" {
			http.Redirect(w, r, "/landing", http.StatusFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer webhook.Close()

	server := &Server{Cfg: &config.Config{IMPushURL: webhook.URL + "/redirect"}}
	if server.pushIM(context.Background(), "test-user", "测试", "内容", "/work") {
		t.Fatal("expected webhook redirect to fail, even though the redirect destination is reachable")
	}
}

func TestUrgeReportsWithLocalMongo(t *testing.T) {
	uri := os.Getenv("OA_NOTIFICATION_TEST_MONGO_URI")
	if uri == "" {
		t.Skip("set OA_NOTIFICATION_TEST_MONGO_URI to a disposable MongoDB")
	}
	ctx := context.Background()
	db, err := store.Connect(uri, "oa_test_notification_"+primitive.NewObjectID().Hex())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.DB.Drop(ctx); err != nil {
			t.Error(err)
		}
		_ = db.Client.Disconnect(ctx)
	})
	if err := db.EnsureIndexes(ctx); err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		name     string
		httpCode int
		imStatus string
	}{
		{"unconfigured", 0, imNotConfigured},
		{"accepted", http.StatusNoContent, imSucceeded},
		{"rejected", http.StatusServiceUnavailable, imFailed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			const lead = "manager"
			const missing = "missing"
			cfg := &config.Config{CompanyID: tc.name, Secret: "local-notification-test"}
			var webhookCalls atomic.Int32
			if tc.httpCode != 0 {
				pusher := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					var body map[string]string
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body["recv_id"] != missing {
						t.Error("expected one webhook for the only missing, in-scope employee")
					}
					webhookCalls.Add(1)
					w.WriteHeader(tc.httpCode)
				}))
				defer pusher.Close()
				cfg.IMPushURL = pusher.URL
			}
			employees := []model.Employee{
				{UserID: lead, Role: "manager"},
				{UserID: "submitted-1", ManagerID: lead},
				{UserID: "submitted-2", ManagerID: lead},
				{UserID: "submitted-3", ManagerID: lead},
				{UserID: missing, ManagerID: lead},
				{UserID: "disabled", ManagerID: lead, Disabled: true},
				{UserID: "outside"},
			}
			for _, employee := range employees {
				employee.CompanyID, employee.RealName = cfg.CompanyID, employee.UserID
				if _, err := db.Employees().InsertOne(ctx, employee); err != nil {
					t.Fatal(err)
				}
			}
			today := todayStr(time.Now())
			for i := 1; i <= 3; i++ {
				userID := fmt.Sprintf("submitted-%d", i)
				_, err := db.Reports().InsertOne(ctx, model.ReportRecord{
					ID: userID, CompanyID: cfg.CompanyID, Period: today, Type: "daily",
					Status: "submitted", Author: model.ReportAuthor{UserID: userID},
				})
				if err != nil {
					t.Fatal(err)
				}
			}
			router := NewServer(db, cfg, nil).Router()
			type envelope struct {
				Code int             `json:"code"`
				Msg  string          `json:"msg"`
				Data json.RawMessage `json:"data"`
			}
			call := func(method, path, uid, body string) envelope {
				req := httptest.NewRequest(method, "/oa/api/v1"+path, strings.NewReader(body))
				req.Header.Set("Content-Type", "application/json")
				token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"UserID": uid}).SignedString([]byte(cfg.Secret))
				if err != nil {
					t.Error(err)
					return envelope{Code: -1}
				}
				req.Header.Set("token", token)
				out := httptest.NewRecorder()
				router.ServeHTTP(out, req)
				var response envelope
				if err := json.Unmarshal(out.Body.Bytes(), &response); err != nil {
					t.Error(err)
					return envelope{Code: -1}
				}
				return response
			}

			rateResponse := call(http.MethodGet, "/report/submit-rate?date="+today, lead, "")
			var rate model.SubmitRateResult
			if err := json.Unmarshal(rateResponse.Data, &rate); err != nil || rateResponse.Code != 0 ||
				rate.Done != 3 || rate.Total != 4 || rate.Today != today {
				t.Fatalf("expected team submit rate 3/4, got %+v (%s)", rate, rateResponse.Msg)
			}
			pastResponse := call(http.MethodPost, "/report/urge", lead, `{"date":"2000-01-01"}`)
			if pastResponse.Code == 0 || !strings.Contains(pastResponse.Msg, "当天") {
				t.Fatalf("expected historical urge to fail, got %+v", pastResponse)
			}

			results := make(chan envelope, 10)
			for range [10]struct{}{} {
				go func() {
					results <- call(http.MethodPost, "/report/urge", lead, `{"date":"`+today+`"}`)
				}()
			}
			var total urgeReportResult
			for range [10]struct{}{} {
				res := <-results
				var one urgeReportResult
				if err := json.Unmarshal(res.Data, &one); err != nil || res.Code != 0 {
					t.Fatalf("urge failed: %+v %v", res, err)
				}
				total.Urged += one.Urged
				total.Skipped += one.Skipped
				total.IMSucceeded += one.IMSucceeded
				total.IMFailed += one.IMFailed
				total.IMNotConfigured += one.IMNotConfigured
				total.Pushed = total.Pushed || one.Pushed
			}
			expected := urgeReportResult{Urged: 1, Skipped: 9}
			switch tc.imStatus {
			case imSucceeded:
				expected.IMSucceeded = 1
				expected.Pushed = true
			case imFailed:
				expected.IMFailed = 1
			case imNotConfigured:
				expected.IMNotConfigured = 1
			}
			if total != expected {
				t.Fatalf("urge summary %+v, want %+v", total, expected)
			}
			wantCalls := int32(1)
			if tc.httpCode == 0 {
				wantCalls = 0
			}
			if got := webhookCalls.Load(); got != wantCalls {
				t.Fatalf("webhook calls = %d, want %d", got, wantCalls)
			}
			count, err := db.Notifications().CountDocuments(ctx, bson.M{"company_id": cfg.CompanyID})
			if err != nil || count != 1 {
				t.Fatalf("notifications = %d, err=%v", count, err)
			}

			var display struct {
				Unread int                  `json:"unread"`
				List   []model.Notification `json:"list"`
			}
			response := call(http.MethodGet, "/notifications/list", missing, "")
			if err := json.Unmarshal(response.Data, &display); err != nil || response.Code != 0 ||
				display.Unread != 1 || len(display.List) != 1 || display.List[0].IMStatus != tc.imStatus {
				t.Fatalf("expected one station notice with %s: %+v", tc.imStatus, display)
			}
			readBody := `{"notification_id":"` + display.List[0].ID + `"}`
			read := call(http.MethodPost, "/notifications/read", lead, readBody)
			if read.Code != 0 || !strings.Contains(string(read.Data), `"updated":0`) {
				t.Fatalf("another user could mark this notice: %+v", read)
			}
			read = call(http.MethodPost, "/notifications/read", missing, readBody)
			if read.Code != 0 || !strings.Contains(string(read.Data), `"updated":1`) {
				t.Fatalf("mark read failed: %+v", read)
			}
			response = call(http.MethodGet, "/notifications/list", missing, "")
			if err := json.Unmarshal(response.Data, &display); err != nil || display.Unread != 0 || len(display.List) != 0 {
				t.Fatalf("notice still unread: %+v (%v)", display, err)
			}
		})
	}
}
