package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
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
	"github.com/xinbo/xinbo-oa/internal/filestore"
	"github.com/xinbo/xinbo-oa/internal/model"
	"github.com/xinbo/xinbo-oa/internal/store"
)

func TestEmployeeContractWorkflow(t *testing.T) {
	mongoURI, minioEndpoint := os.Getenv("OA_AUDIT_TEST_MONGO_URI"), os.Getenv("OA_CONTRACT_TEST_MINIO_ENDPOINT")
	if mongoURI == "" || minioEndpoint == "" {
		t.Skip("requires isolated MongoDB and MinIO")
	}
	ctx := context.Background()
	cfg := &config.Config{
		CompanyID: primitive.NewObjectID().Hex(), Secret: "contract-workflow-test", FileMaxMB: 10,
		MinioEndpoint: minioEndpoint, MinioBucket: "contract-test",
		MinioAccessKey: os.Getenv("OA_CONTRACT_TEST_MINIO_ACCESS_KEY"),
		MinioSecretKey: os.Getenv("OA_CONTRACT_TEST_MINIO_SECRET_KEY"),
	}
	st, err := store.Connect(mongoURI, "oa_contract_test_"+cfg.CompanyID)
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
	files, err := filestore.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	s := NewServer(st, cfg, files)
	router := s.Router()
	for _, e := range []model.Employee{
		{UserID: "hr", Role: "hr"},
		{UserID: "admin", Role: "employee", IsAdmin: true},
		{UserID: "manager", Role: "manager"},
		{UserID: "employee", Role: "employee", ManagerID: "manager"},
		{UserID: "disabled-hr", Role: "hr", Disabled: true},
	} {
		e.CompanyID, e.RealName, e.Department = cfg.CompanyID, e.UserID, "测试组"
		if _, err := st.Employees().InsertOne(ctx, e); err != nil {
			t.Fatal(err)
		}
	}
	call := func(method, path, uid, contentType string, body io.Reader) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "/oa/api/v1"+path, body)
		req.Header.Set("Content-Type", contentType)
		if uid != "" {
			token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"UserID": uid}).SignedString([]byte(cfg.Secret))
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("token", token)
		}
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		return out
	}
	decode := func(out *httptest.ResponseRecorder) (int, json.RawMessage) {
		t.Helper()
		var result struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(out.Body.Bytes(), &result); err != nil {
			t.Fatalf("expected API response, got HTTP %d: %s", out.Code, out.Body.String())
		}
		return result.Code, result.Data
	}
	code, data := decode(call(http.MethodGet, "/admin/contract?employee_id=employee", "hr", "", nil))
	if code != 0 || string(data) != "null" {
		t.Fatalf("employee profile without contract should return null: %d/%s", code, data)
	}
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	_ = form.WriteField("scope", "contract")
	_ = form.WriteField("contract_employee_id", "employee")
	file, err := form.CreateFormFile("file", "agreement.txt")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.WriteString(file, "private contract original")
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}
	code, _ = decode(call(http.MethodPost, "/files/upload", "manager", form.FormDataContentType(), bytes.NewReader(body.Bytes())))
	if code != 403 {
		t.Errorf("manager could upload a contract file: %d", code)
	}
	code, data = decode(call(http.MethodPost, "/files/upload", "hr", form.FormDataContentType(), &body))
	var uploaded struct {
		ID  string `json:"file_id"`
		URL string `json:"signed_url"`
	}
	if err := json.Unmarshal(data, &uploaded); code != 0 || err != nil || uploaded.ID == "" || uploaded.URL != "" {
		t.Fatalf("contract upload failed or returned a signed link: %d/%s", code, data)
	}
	t.Cleanup(func() {
		if meta := s.loadFile(ctx, uploaded.ID); meta != nil {
			if err := files.Remove(ctx, meta.ObjectKey); err != nil {
				t.Error(err)
			}
		}
	})
	save := func(employee string) (int, json.RawMessage) {
		return decode(call(http.MethodPost, "/admin/contract/save", "hr", "application/json", strings.NewReader(
			`{"employee_id":"`+employee+`","start_date":"2026-01-01","end_date":"2027-01-01","attachment_ids":["`+uploaded.ID+`"]}`,
		)))
	}
	if code, _ := save("manager"); code == 0 {
		t.Error("contract file was accepted for a different employee")
	}
	if code, data := save("employee"); code != 0 || !strings.Contains(string(data), "agreement.txt") {
		t.Fatalf("contract save failed: %d/%s", code, data)
	}
	for _, uid := range []string{"manager", "employee"} {
		if code, _ := decode(call(http.MethodGet, "/admin/contract?employee_id=employee", uid, "", nil)); code != 403 {
			t.Errorf("%s could read contract metadata", uid)
		}
	}
	download := "/files/" + uploaded.ID + "?contract_employee_id=employee"
	for _, uid := range []string{"", "manager", "employee"} {
		if out := call(http.MethodGet, download, uid, "", nil); out.Code != http.StatusForbidden {
			t.Errorf("%q could read contract original: %d", uid, out.Code)
		}
	}
	if out := call(http.MethodGet, download, "admin", "", nil); out.Code != http.StatusOK || out.Body.String() != "private contract original" {
		t.Errorf("second administrator could not read attachment: %d", out.Code)
	}
	code, data = decode(call(http.MethodGet, "/admin/employees", "hr", "", nil))
	if code != 0 || strings.Contains(string(data), "agreement.txt") || strings.Contains(string(data), "2027-01-01") {
		t.Errorf("employee list unexpectedly contained private contract data: %d/%s", code, data)
	}

	t.Run("reminders are inclusive, limited to HR, and repeat only for a renewed expiry", func(t *testing.T) {
		now := time.Date(2026, time.November, 20, 15, 0, 0, 0, time.Local)
		setExpiry := func(uid string, days int) {
			t.Helper()
			expiry := todayStr(now.AddDate(0, 0, days))
			body := strings.NewReader(`{"employee_id":"` + uid + `","start_date":"2026-01-01","end_date":"` + expiry + `"}`)
			if code, data := decode(call(http.MethodPost, "/admin/contract/save", "hr", "application/json", body)); code != 0 {
				t.Fatalf("setting contract expiry failed: %d/%s", code, data)
			}
		}
		setExpiry("employee", 30)
		setExpiry("manager", 31)
		setExpiry("admin", -1)
		setExpiry("hr", 0)
		scan := func() {
			t.Helper()
			if err := s.sendContractExpiryReminders(ctx, now); err != nil {
				t.Fatal(err)
			}
		}
		assertReminderCount := func(uid string, want int64) {
			t.Helper()
			count, err := st.Notifications().CountDocuments(ctx, bson.M{
				"company_id": cfg.CompanyID, "kind": "contract_expiry", "user_id": uid,
			})
			if err != nil || count != want {
				t.Errorf("recipient %s: expected %d reminders, got %d (%v)", uid, want, count, err)
			}
		}
		scan()
		scan()
		assertReminderCount("hr", 2)
		assertReminderCount("admin", 2)
		assertReminderCount("manager", 0)
		assertReminderCount("employee", 0)
		assertReminderCount("disabled-hr", 0)
		setExpiry("employee", 25)
		scan()
		scan()
		assertReminderCount("hr", 3)
		assertReminderCount("admin", 3)
	})
}
