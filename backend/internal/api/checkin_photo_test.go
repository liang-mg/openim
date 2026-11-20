package api

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestSubmitCheckinRejectsNewPhotosOver300KiB(t *testing.T) {
	router := gin.New()
	router.Use(gin.RecoveryWithWriter(io.Discard))
	router.POST("/submit", (&Server{}).SubmitCheckin)
	photo := "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(make([]byte, 307201))
	request := httptest.NewRequest(http.MethodPost, "/submit",
		strings.NewReader(`{"type":"on","photo":"`+photo+`"}`))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	var result struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("expected a photo size error, got HTTP %d: %s", response.Code, response.Body.String())
	}
	if result.Code == 0 || !strings.Contains(result.Msg, "300 KiB") {
		t.Fatalf("expected a photo size error, got %+v", result)
	}
}

func TestParseCheckinPhotoAcceptsExactLimit(t *testing.T) {
	photo := "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(make([]byte, 307200))
	reader, size, mime, ext, problem := parseCheckinPhoto(photo)
	if problem != "" || reader == nil || size != 307200 || mime != "image/jpeg" || ext != ".jpg" {
		t.Fatalf("expected a 307200-byte JPEG upload, got size=%d mime=%q ext=%q error=%q", size, mime, ext, problem)
	}
}

func TestParseCheckinPhotoRejectsFileLinksOnNewCheckins(t *testing.T) {
	reader, _, _, _, problem := parseCheckinPhoto("/oa/api/v1/files/previous-photo")
	if problem == "" || reader != nil {
		t.Fatal("expected a new clock-in to require image data instead of a file link")
	}
}
