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
	"go.mongodb.org/mongo-driver/bson/primitive"

	"github.com/xinbo/xinbo-oa/internal/config"
	"github.com/xinbo/xinbo-oa/internal/filestore"
	"github.com/xinbo/xinbo-oa/internal/model"
	"github.com/xinbo/xinbo-oa/internal/store"
)

func TestLeaveAttachmentWorkflow(t *testing.T) {
	mongoURI, minioEndpoint := os.Getenv("OA_LEAVE_TEST_MONGO_URI"), os.Getenv("OA_LEAVE_TEST_MINIO_ENDPOINT")
	if mongoURI == "" || minioEndpoint == "" {
		t.Skip("requires isolated MongoDB and MinIO; set OA_LEAVE_TEST_MONGO_URI and OA_LEAVE_TEST_MINIO_ENDPOINT")
	}
	ctx := context.Background()
	cfg := &config.Config{
		CompanyID: primitive.NewObjectID().Hex(), Secret: "leave-attachment-test",
		MinioEndpoint: minioEndpoint, MinioBucket: "leave-test",
		MinioAccessKey: os.Getenv("OA_LEAVE_TEST_MINIO_ACCESS_KEY"),
		MinioSecretKey: os.Getenv("OA_LEAVE_TEST_MINIO_SECRET_KEY"),
		FileMaxMB:      20,
	}
	db, err := store.Connect(mongoURI, "oa_leave_test_"+cfg.CompanyID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.DB.Drop(ctx); err != nil {
			t.Error(err)
		}
		if err := db.Client.Disconnect(ctx); err != nil {
			t.Error(err)
		}
	})
	files, err := filestore.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(db, cfg, files)
	router := server.Router()
	for _, employee := range []model.Employee{
		{UserID: "owner", ManagerID: "reviewer", Role: "employee"},
		{UserID: "reviewer", ManagerID: "leader", Role: "manager"},
		{UserID: "leader", Role: "leader"},
		{UserID: "unrelated", Role: "leader"},
		{UserID: "hr", Role: "hr"},
		{UserID: "disabled", Role: "hr", Disabled: true},
	} {
		employee.CompanyID = cfg.CompanyID
		if _, err := db.Employees().InsertOne(ctx, employee); err != nil {
			t.Fatal(err)
		}
	}

	call := func(method, path, uid, contentType string, body io.Reader) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, body)
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
		var response struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(out.Body.Bytes(), &response); err != nil {
			t.Fatalf("expected JSON response, got status %d and body %q: %v", out.Code, out.Body.String(), err)
		}
		return response.Code, response.Data
	}
	upload := func(uid, scope string) string {
		t.Helper()
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		if err := form.WriteField("scope", scope); err != nil {
			t.Fatal(err)
		}
		file, err := form.CreateFormFile("file", "proof.txt")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = io.WriteString(file, "attachment contents"); err != nil {
			t.Fatal(err)
		}
		if err = form.Close(); err != nil {
			t.Fatal(err)
		}
		code, data := decode(call(http.MethodPost, "/oa/api/v1/files/upload", uid, form.FormDataContentType(), &body))
		var meta struct {
			ID  string `json:"file_id"`
			URL string `json:"signed_url"`
		}
		if err := json.Unmarshal(data, &meta); code != 0 || err != nil || meta.ID == "" {
			t.Fatalf("upload %s failed, code %d, data %s: %v", scope, code, data, err)
		}
		t.Cleanup(func() {
			if stored := server.loadFile(ctx, meta.ID); stored != nil {
				if err := files.Remove(ctx, stored.ObjectKey); err != nil {
					t.Error(err)
				}
			}
		})
		if scope == "leave" && meta.URL != "" {
			t.Error("leave upload returned a signed link")
		}
		return meta.ID
	}
	submit := func(fields string) (int, json.RawMessage) {
		t.Helper()
		return decode(call(http.MethodPost, "/oa/api/v1/leave/submit", "owner", "application/json", strings.NewReader(
			`{"type":"sick","start_date":"2026-11-20","end_date":"2026-11-20","reason":"fixture"`+fields+`}`,
		)))
	}

	proof := upload("owner", "leave")
	reportFile := upload("owner", "report")
	otherFile := upload("unrelated", "leave")
	for _, id := range []string{reportFile, otherFile, "missing"} {
		if code, _ := submit(`,"attachment_ids":["` + id + `"]`); code == 0 {
			t.Errorf("accepted invalid attachment %q", id)
		}
	}
	code, data := submit("")
	var oldLeave model.LeaveRequest
	if err := json.Unmarshal(data, &oldLeave); code != 0 || err != nil || oldLeave.ID == "" {
		t.Fatalf("leave without attachments failed, code %d, data %s: %v", code, data, err)
	}
	code, data = submit(`,"attachment_ids":["` + proof + `"]`)
	var leave model.LeaveRequest
	if err := json.Unmarshal(data, &leave); code != 0 || err != nil || leave.ID == "" {
		t.Fatalf("leave with attachment failed, code %d, data %s: %v", code, data, err)
	}
	code, data = decode(call(http.MethodGet, "/oa/api/v1/leave/list?scope=mine", "owner", "", nil))
	var refreshed struct {
		List []model.LeaveRequest `json:"list"`
	}
	if err := json.Unmarshal(data, &refreshed); code != 0 || err != nil || len(refreshed.List) != 2 {
		t.Fatalf("refresh failed, code %d, data %s: %v", code, data, err)
	}
	for _, item := range refreshed.List {
		switch item.ID {
		case leave.ID:
			if len(item.Attachments) != 1 || item.Attachments[0].FileID != proof || item.Attachments[0].Name != "proof.txt" {
				t.Errorf("refresh did not return the saved attachment: %+v", item)
			}
		case oldLeave.ID:
			if len(item.Attachments) != 0 {
				t.Errorf("leave without attachments decoded incorrectly: %+v", item)
			}
		default:
			t.Errorf("unexpected leave request: %+v", item)
		}
	}
	download := "/oa/api/v1/files/" + proof
	if code, _ = decode(call(http.MethodGet, download+"/link", "owner", "", nil)); code == 0 {
		t.Error("generic link endpoint signed a leave attachment")
	}
	for _, tc := range []struct {
		name, uid, path string
		status          int
	}{
		{"applicant", "owner", download + "?leave_id=" + leave.ID, http.StatusOK},
		{"assigned approver", "reviewer", download + "?leave_id=" + leave.ID, http.StatusOK},
		{"team scope", "leader", download + "?leave_id=" + leave.ID, http.StatusOK},
		{"company scope", "hr", download + "?leave_id=" + leave.ID, http.StatusOK},
		{"unrelated account", "unrelated", download + "?leave_id=" + leave.ID, http.StatusForbidden},
		{"disabled account", "disabled", download + "?leave_id=" + leave.ID, http.StatusForbidden},
		{"no leave record", "owner", download, http.StatusForbidden},
		{"unrelated leave record", "owner", download + "?leave_id=" + oldLeave.ID, http.StatusForbidden},
		{"anonymous signed URL", "", server.signedPath(proof, "owner", time.Now().Add(time.Minute)) + "&leave_id=" + leave.ID, http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			out := call(http.MethodGet, tc.path, tc.uid, "", nil)
			if out.Code != tc.status || tc.status == http.StatusOK && out.Body.String() != "attachment contents" {
				t.Fatalf("download status %d, body %q", out.Code, out.Body.String())
			}
		})
	}
	code, _ = decode(call(http.MethodPost, "/oa/api/v1/leave/approve", "reviewer", "application/json",
		strings.NewReader(`{"leave_id":"`+leave.ID+`","action":"approve","comment":"ok"}`),
	))
	if code != 0 || !server.approvedLeaveDays(ctx, []string{"owner"}, "2026-11")["owner"]["2026-11-20"] {
		t.Error("approved leave is missing from attendance data")
	}
}
