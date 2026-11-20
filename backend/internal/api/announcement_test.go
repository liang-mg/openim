package api

import (
	"context"
	"encoding/json"
	"fmt"
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

func TestDepartmentAnnouncementSnapshotsRecipientsAndFirstRead(t *testing.T) {
	uri := os.Getenv("OA_NOTIFICATION_TEST_MONGO_URI")
	if uri == "" {
		t.Skip("set OA_NOTIFICATION_TEST_MONGO_URI to a disposable MongoDB")
	}
	ctx := context.Background()
	company := primitive.NewObjectID().Hex()
	db, err := store.Connect(uri, "oa_test_announcement_"+company)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.DB.Drop(ctx); err != nil {
			t.Error(err)
		}
		_ = db.Client.Disconnect(ctx)
	})
	if _, err := db.Departments().InsertOne(ctx, bson.M{
		"company_id": company, "department_id": "engineering", "name": "技术部", "status": "active",
	}); err != nil {
		t.Fatal(err)
	}
	for _, employee := range []model.Employee{
		{UserID: "hr", Role: "hr"},
		{UserID: "other-admin", IsAdmin: true},
		{UserID: "in-1", RealName: "甲", DepartmentID: "engineering"},
		{UserID: "in-2", RealName: "乙", DepartmentID: "engineering"},
		{UserID: "out", RealName: "丙", DepartmentID: "sales"},
		{UserID: "disabled", DepartmentID: "engineering", Disabled: true},
	} {
		employee.CompanyID = company
		if _, err := db.Employees().InsertOne(ctx, employee); err != nil {
			t.Fatal(err)
		}
	}
	secret := "local-announcement-test"
	router := NewServer(db, &config.Config{CompanyID: company, Secret: secret}, nil).Router()
	call := func(method, path, uid, body string, wantOK bool) json.RawMessage {
		t.Helper()
		req := httptest.NewRequest(method, "/oa/api/v1"+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"UserID": uid}).SignedString([]byte(secret))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("token", token)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		var result struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || (result.Code == 0) != wantOK {
			t.Fatalf("%s %s for %s: HTTP %d %s (%v)", method, path, uid, response.Code, response.Body.String(), err)
		}
		return result.Data
	}

	body := `{"title":"部门测试公告","content":"请核对安排","scope":"department","department_id":"engineering"}`
	call("POST", "/admin/announcements", "in-1", body, false)
	data := call("POST", "/admin/announcements", "hr", body, true)
	var published struct {
		ID      string `json:"announcement_id"`
		Total   int    `json:"recipient_count"`
		Notices int    `json:"notified"`
	}
	if err := json.Unmarshal(data, &published); err != nil || published.ID == "" || published.Total != 2 || published.Notices != 2 {
		t.Fatalf("expected 2 notified recipients, got %+v (%v)", published, err)
	}
	detailPath := "/announcements/" + published.ID
	receiptsPath := "/admin/announcements/" + published.ID + "/receipts"
	call("GET", detailPath, "out", "", false)
	call("POST", detailPath+"/read", "out", "{}", false)
	call("GET", receiptsPath, "other-admin", "", false)
	if _, err := db.Employees().UpdateOne(ctx, bson.M{"user_id": "out"}, bson.M{"$set": bson.M{"department_id": "engineering"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Employees().UpdateOne(ctx, bson.M{"user_id": "in-1"}, bson.M{"$set": bson.M{"department_id": "sales", "real_name": "已改名"}}); err != nil {
		t.Fatal(err)
	}
	call("GET", detailPath, "out", "", false)
	info := call("GET", detailPath, "in-1", "", true)
	if strings.Contains(string(info), "recipients") || !strings.Contains(string(info), "请核对安排") {
		t.Fatalf("detail exposed receipts or omitted content: %s", info)
	}
	notices := call("GET", "/notifications/list", "in-1", "", true)
	if !strings.Contains(string(notices), fmt.Sprintf("/announcements/%s", published.ID)) {
		t.Fatalf("expected notice linked to announcement: %s", notices)
	}

	first := call("POST", detailPath+"/read", "in-1", "{}", true)
	time.Sleep(15 * time.Millisecond)
	again := call("POST", detailPath+"/read", "in-1", "{}", true)
	if string(first) != string(again) || strings.Contains(string(first), `"read_at":0`) {
		t.Fatalf("first receipt changed: first=%s again=%s", first, again)
	}
	receiptData := call("GET", receiptsPath, "hr", "", true)
	var receipts struct {
		Read       int `json:"read_count"`
		Recipients []struct {
			UserID string `json:"user_id"`
			Name   string `json:"name"`
			ReadAt int64  `json:"read_at"`
		} `json:"recipients"`
	}
	if err := json.Unmarshal(receiptData, &receipts); err != nil || receipts.Read != 1 || len(receipts.Recipients) != 2 {
		t.Fatalf("expected 1 read and 1 unread receipt: %+v (%v)", receipts, err)
	}
	for _, recipient := range receipts.Recipients {
		if recipient.UserID == "in-1" && (recipient.Name != "甲" || recipient.ReadAt == 0) {
			t.Fatalf("expected original name and first read timestamp: %+v", recipient)
		}
		if recipient.UserID == "in-2" && recipient.ReadAt != 0 {
			t.Fatalf("unopened notice counted as read: %+v", recipient)
		}
	}
	notices = call("GET", "/notifications/list", "in-1", "", true)
	if strings.Contains(string(notices), published.ID) {
		t.Fatalf("viewed announcement notification is still unread: %s", notices)
	}
	companyData := call("POST", "/admin/announcements", "hr",
		`{"title":"全体通知","content":"仅在职员工","scope":"company"}`, true)
	if err := json.Unmarshal(companyData, &published); err != nil || published.Total != 5 || published.Notices != 5 {
		t.Fatalf("expected all 5 active employees to get company announcement: %+v (%v)", published, err)
	}
	call("GET", "/announcements/"+published.ID, "out", "", true)
	call("GET", "/announcements/"+published.ID, "disabled", "", false)
}
