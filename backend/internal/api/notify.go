package api

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/bson/primitive"

	"github.com/xinbo/xinbo-oa/internal/auth"
	"github.com/xinbo/xinbo-oa/internal/model"
)

// 站内通知 + 可选 IM 推送（P2-3）
//
// 原则：**站内信是主通道，IM 是附加送达方式。**
// 推送失败不影响站内可见，也不谎报"已推送"——接口里把 pushed 如实返回。

// notify 写一条站内通知，并在配置了 IMPushURL 时顺手推一条 IM。
// 通知失败不阻断业务动作（审批已经成功了，不能因为通知没发出去就回滚）。
func (s *Server) notify(ctx context.Context, userID, kind, title, content, path string) error {
	if userID == "" {
		return nil
	}
	now := time.Now().UnixMilli()
	rec := model.Notification{
		ID:        primitive.NewObjectID().Hex(),
		CompanyID: s.Cfg.CompanyID,
		UserID:    userID,
		Kind:      kind,
		Title:     title,
		Content:   content,
		Path:      path,
		Read:      false,
		CreatedAt: now,
	}
	if _, err := s.Store.Notifications().InsertOne(ctx, rec); err != nil {
		log.Printf("[notify] insert failed uid=%s kind=%s: %v", userID, kind, err)
		return err
	}
	s.pushIM(userID, title, content, path)
	return nil
}

// pushIM 推送到 IM。没配置地址直接返回 false（不算错误）。
func (s *Server) pushIM(userID, title, content, path string) bool {
	if s.Cfg.IMPushURL == "" {
		return false
	}
	body, err := json.Marshal(map[string]string{
		"recv_id": userID,
		"title":   title,
		"content": content,
		"path":    path,
	})
	if err != nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.Cfg.IMPushURL, bytes.NewReader(body))
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", "application/json")
	if s.Cfg.IMPushToken != "" {
		req.Header.Set("Authorization", "Bearer "+s.Cfg.IMPushToken)
	}
	resp, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		log.Printf("[notify] im push failed uid=%s: %v", userID, err)
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
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

// NotificationRead 标记已读：不传 id 就全部已读
func (s *Server) NotificationRead(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var req struct {
		ID  string `json:"notification_id"`
		All bool   `json:"all"`
	}
	_ = c.ShouldBindJSON(&req) // 允许空 body：等同全部已读

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

// notifiedToday 今天是否已经发过同 kind 且同一 path 的通知，用于催交去重
// （一个人一天被催三次只会让人反感）。
func (s *Server) notifiedToday(ctx context.Context, uid, kind, path string) bool {
	// 用本地日界，而不是 Truncate（那是 UTC 零点），否则每天早上八点前的判断会错一天
	y, m, d := time.Now().Date()
	start := time.Date(y, m, d, 0, 0, 0, 0, time.Local)
	n, err := s.Store.Notifications().CountDocuments(ctx, bson.M{
		"company_id": s.Cfg.CompanyID,
		"user_id":    uid,
		"kind":       kind,
		"path":       path,
		"created_at": bson.M{"$gte": start.UnixMilli()},
	})
	return err == nil && n > 0
}
