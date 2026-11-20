package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/xinbo/xinbo-oa/internal/auth"
	"github.com/xinbo/xinbo-oa/internal/model"
)

const (
	imPending       = "pending"
	imSucceeded     = "succeeded"
	imFailed        = "failed"
	imNotConfigured = "not_configured"
)

type notificationDelivery struct {
	Delivered bool
	IMStatus  string
}

// 空 key 允许重复通知。有 key 时 Mongo 的 _id 唯一约束在并发下也只接受一条。
func (s *Server) storeNotification(ctx context.Context, userID, kind, key, title, content, path string) (model.Notification, error) {
	if userID == "" {
		return model.Notification{}, nil
	}
	rec := model.Notification{
		ID:        primitive.NewObjectID().Hex(),
		CompanyID: s.Cfg.CompanyID,
		UserID:    userID,
		Kind:      kind,
		Title:     title,
		Content:   content,
		Path:      path,
		Read:      false,
		CreatedAt: time.Now().UnixMilli(),
		IMStatus:  imNotConfigured,
	}
	if s.Cfg.IMPushURL != "" {
		rec.IMStatus = imPending
	}
	doc := struct {
		BusinessID         string `bson:"_id,omitempty"`
		model.Notification `bson:",inline"`
	}{Notification: rec}
	if key != "" {
		fields, _ := json.Marshal([]string{s.Cfg.CompanyID, userID, kind, key})
		doc.BusinessID = fmt.Sprintf("%x", sha256.Sum256(fields))
		rec.ID = doc.BusinessID
		doc.Notification.ID = rec.ID
	}
	if _, err := s.Store.Notifications().InsertOne(ctx, doc); err != nil {
		if key != "" && mongo.IsDuplicateKeyError(err) {
			return model.Notification{}, nil
		}
		log.Printf("[notify] insert failed uid=%s kind=%s: %v", userID, kind, err)
		return model.Notification{}, err
	}
	return rec, nil
}

func (s *Server) finishNotification(ctx context.Context, rec model.Notification) string {
	if rec.IMStatus != imPending {
		return rec.IMStatus
	}
	status := imFailed
	if s.pushIM(ctx, rec.UserID, rec.Title, rec.Content, rec.Path) {
		status = imSucceeded
	}
	updateCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, err := s.Store.Notifications().UpdateOne(updateCtx, bson.M{
		"company_id": rec.CompanyID, "notification_id": rec.ID, "user_id": rec.UserID,
	}, bson.M{"$set": bson.M{"im_status": status}})
	if err != nil {
		log.Printf("[notify] update im status failed uid=%s status=%s: %v", rec.UserID, status, err)
	}
	return status
}

func (s *Server) notifyOnce(ctx context.Context, userID, kind, key, title, content, path string) (notificationDelivery, error) {
	rec, err := s.storeNotification(ctx, userID, kind, key, title, content, path)
	if err != nil || rec.ID == "" {
		return notificationDelivery{}, err
	}
	pushCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return notificationDelivery{Delivered: true, IMStatus: s.finishNotification(pushCtx, rec)}, nil
}

// 审批流程保存站内消息后即可返回，独立记录外部请求结果。
func (s *Server) notifyEvent(ctx context.Context, userID, kind, key, title, content, path string) error {
	rec, err := s.storeNotification(ctx, userID, kind, key, title, content, path)
	if err != nil || rec.IMStatus != imPending {
		return err
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		s.finishNotification(ctx, rec)
	}()
	return nil
}

func (s *Server) notify(ctx context.Context, userID, kind, title, content, path string) error {
	return s.notifyEvent(ctx, userID, kind, "", title, content, path)
}

func approvalNotificationPath(tab, kind, id string) string {
	params := url.Values{"tab": {tab}, "kind": {kind}, "item_id": {id}}
	return "/approvals?" + params.Encode()
}

func (s *Server) notifyReportReview(ctx context.Context, rec model.ReportRecord, stage string, org reportReviewOrg) {
	kind, title := "report_comment", "日报待点评"
	for _, reviewer := range org.chain(rec.Author.UserID) {
		actions := org.actions(reviewer.UserID, rec.Author.UserID, stage)
		if stage == "pending_leader" {
			kind, title = "report_review", "日报待审阅"
			if !actions.CanArchive {
				continue
			}
		} else if !actions.CanComment {
			continue
		}
		key := rec.ID
		if rec.SubmitTime != nil {
			key = fmt.Sprintf("%s:%d", key, *rec.SubmitTime)
		}
		_ = s.notifyEvent(ctx, reviewer.UserID, kind, key, title,
			fmt.Sprintf("%s 提交的 %s 日报", rec.Author.Name, rec.Period), reportReviewPath(rec.ID))
		return
	}
}

// 批量发送先保存所有站内通知。外部通道限时，并发请求失败不影响站内可见。
func (s *Server) finishNotifications(records []model.Notification) map[string]int {
	results := make([]string, len(records))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var pending sync.WaitGroup
	slots := make(chan struct{}, 8)
	for i, rec := range records {
		if rec.IMStatus != imPending {
			results[i] = rec.IMStatus
			continue
		}
		pending.Add(1)
		go func(i int, rec model.Notification) {
			defer pending.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			results[i] = s.finishNotification(ctx, rec)
		}(i, rec)
	}
	pending.Wait()
	counts := make(map[string]int, 3)
	for _, status := range results {
		counts[status]++
	}
	return counts
}

func (s *Server) pushIM(ctx context.Context, userID, title, content, path string) bool {
	body, _ := json.Marshal(map[string]string{
		"recv_id": userID,
		"title":   title,
		"content": content,
		"path":    path,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.Cfg.IMPushURL, bytes.NewReader(body))
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", "application/json")
	if s.Cfg.IMPushToken != "" {
		req.Header.Set("Authorization", "Bearer "+s.Cfg.IMPushToken)
	}
	resp, err := (&http.Client{
		Timeout:       5 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}).Do(req)
	if err != nil {
		log.Printf("[notify] im push failed uid=%s: %v", userID, err)
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		log.Printf("[notify] im push non-2xx uid=%s status=%d", userID, resp.StatusCode)
		return false
	}
	return true
}

// NotificationList 我的通知列表（默认只给未读，?all=1 给全部）
func (s *Server) NotificationList(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	uid := auth.UserID(c)
	filter := bson.M{"company_id": s.Cfg.CompanyID, "user_id": uid}
	if c.Query("all") != "1" {
		filter["read"] = false
	}
	cur, err := s.Store.Notifications().Find(ctx, filter,
		options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}).SetLimit(100))
	if err != nil {
		fail(c, "查询失败")
		return
	}
	var list []model.Notification
	if err = cur.All(ctx, &list); err != nil {
		fail(c, "查询失败")
		return
	}
	if list == nil {
		list = []model.Notification{}
	}
	unread := s.unreadNotificationCount(ctx, uid)
	ok(c, gin.H{"total": len(list), "unread": unread, "list": list, "push_enabled": s.Cfg.IMPushURL != ""})
}

// NotificationRead 标记一条或显式全部已读。
func (s *Server) NotificationRead(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var req struct {
		ID  string `json:"notification_id"`
		All bool   `json:"all"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || (req.ID == "" && !req.All) || (req.ID != "" && req.All) {
		fail(c, "请选择通知或明确标记全部已读")
		return
	}

	uid := auth.UserID(c)
	filter := bson.M{"company_id": s.Cfg.CompanyID, "user_id": uid, "read": false}
	if req.ID != "" {
		filter["notification_id"] = req.ID
	}
	now := time.Now().UnixMilli()
	res, err := s.Store.Notifications().UpdateMany(ctx, filter,
		bson.M{"$set": bson.M{"read": true, "read_at": now}})
	if err != nil {
		fail(c, "操作失败")
		return
	}
	ok(c, gin.H{"updated": res.ModifiedCount})
}

func (s *Server) unreadNotificationCount(ctx context.Context, uid string) int {
	n, err := s.Store.Notifications().CountDocuments(ctx, bson.M{
		"company_id": s.Cfg.CompanyID, "user_id": uid, "read": false,
	})
	if err != nil {
		return 0
	}
	return int(n)
}
