package api

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/xinbo/xinbo-oa/internal/auth"
	"github.com/xinbo/xinbo-oa/internal/model"
)

type announcementSummary struct {
	model.Announcement
	RecipientCount int `json:"recipient_count"`
	ReadCount      int `json:"read_count"`
}

func summarizeAnnouncement(rec model.Announcement) announcementSummary {
	summary := announcementSummary{Announcement: rec, RecipientCount: len(rec.Recipients)}
	for _, recipient := range rec.Recipients {
		if recipient.ReadAt > 0 {
			summary.ReadCount++
		}
	}
	return summary
}

func announcementPath(id string) string { return "/announcements/" + id }

func (s *Server) PublishAnnouncement(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	uid := auth.UserID(c)
	if !s.isAdmin(ctx, uid) {
		failCode(c, 403, "无权发布公告")
		return
	}

	var req struct {
		Title        string `json:"title"`
		Content      string `json:"content"`
		Scope        string `json:"scope"`
		DepartmentID string `json:"department_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, "公告参数错误")
		return
	}
	title, content := strings.TrimSpace(req.Title), strings.TrimSpace(req.Content)
	if title == "" || content == "" || utf8.RuneCountInString(title) > 120 || utf8.RuneCountInString(content) > 6000 {
		fail(c, "请填写公告标题和正文，标题最多 120 字，正文最多 6000 字")
		return
	}
	rec := model.Announcement{
		ID: primitive.NewObjectID().Hex(), CompanyID: s.Cfg.CompanyID,
		Title: title, Content: content, Scope: req.Scope,
		PublisherID: uid, PublisherName: s.applicantDisplayName(ctx, uid).RealName,
		PublishedAt: time.Now().UnixMilli(),
	}
	if rec.PublisherName == "" {
		rec.PublisherName = uid
	}
	filter := bson.M{"company_id": s.Cfg.CompanyID, "disabled": bson.M{"$ne": true}}
	switch req.Scope {
	case "company":
		if req.DepartmentID != "" {
			fail(c, "全公司公告无需选择部门")
			return
		}
	case "department":
		department, err := s.departmentByID(ctx, req.DepartmentID)
		if err != nil {
			fail(c, "请选择有效部门")
			return
		}
		rec.DepartmentID, rec.DepartmentName = department.ID, department.Name
		filter["department_id"] = department.ID
	default:
		fail(c, "请选择发布范围")
		return
	}

	cursor, err := s.Store.Employees().Find(ctx, filter, options.Find().
		SetProjection(bson.M{"user_id": 1, "real_name": 1}).
		SetSort(bson.D{{Key: "real_name", Value: 1}, {Key: "user_id", Value: 1}}))
	if err != nil {
		fail(c, "收件人查询失败")
		return
	}
	var employees []model.Employee
	if err := cursor.All(ctx, &employees); err != nil {
		fail(c, "收件人查询失败")
		return
	}
	for _, employee := range employees {
		if employee.UserID == "" {
			continue
		}
		name := employee.RealName
		if name == "" {
			name = employee.UserID
		}
		rec.Recipients = append(rec.Recipients, model.AnnouncementRecipient{UserID: employee.UserID, Name: name})
	}
	if len(rec.Recipients) == 0 {
		fail(c, "所选范围内没有在职员工")
		return
	}
	if _, err := s.Store.Announcements().InsertOne(ctx, rec); err != nil {
		fail(c, "公告发布失败")
		return
	}

	notified := 0
	for _, recipient := range rec.Recipients {
		err := s.notifyEvent(ctx, recipient.UserID, "announcement", rec.ID, "OA 公告", title, announcementPath(rec.ID))
		if err == nil {
			notified++
		}
	}
	ok(c, gin.H{
		"announcement_id": rec.ID, "recipient_count": len(rec.Recipients),
		"notified": notified, "notification_failures": len(rec.Recipients) - notified,
	})
}

func (s *Server) PublishedAnnouncements(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	uid := auth.UserID(c)
	if !s.isAdmin(ctx, uid) {
		failCode(c, 403, "无权查看公告发布记录")
		return
	}
	cursor, err := s.Store.Announcements().Find(ctx, bson.M{"company_id": s.Cfg.CompanyID, "publisher_id": uid},
		options.Find().SetSort(bson.D{{Key: "published_at", Value: -1}}).SetLimit(100).
			SetProjection(bson.M{"content": 0}))
	if err != nil {
		fail(c, "公告查询失败")
		return
	}
	var records []model.Announcement
	if err := cursor.All(ctx, &records); err != nil {
		fail(c, "公告查询失败")
		return
	}
	list := make([]announcementSummary, 0, len(records))
	for _, rec := range records {
		list = append(list, summarizeAnnouncement(rec))
	}
	ok(c, gin.H{"list": list})
}

func (s *Server) AnnouncementReceipts(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	uid := auth.UserID(c)
	if !s.isAdmin(ctx, uid) {
		failCode(c, 403, "无权查看公告回执")
		return
	}
	var rec model.Announcement
	if err := s.Store.Announcements().FindOne(ctx, bson.M{
		"_id": c.Param("id"), "company_id": s.Cfg.CompanyID, "publisher_id": uid,
	}).Decode(&rec); err != nil {
		failCode(c, 404, "公告不存在或无权查看")
		return
	}
	ok(c, struct {
		announcementSummary
		Recipients []model.AnnouncementRecipient `json:"recipients"`
	}{announcementSummary: summarizeAnnouncement(rec), Recipients: rec.Recipients})
}

func (s *Server) announcementRecipientFilter(id, uid string) bson.M {
	return bson.M{"_id": id, "company_id": s.Cfg.CompanyID, "recipients.user_id": uid}
}

func (s *Server) AnnouncementDetail(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	filter := s.announcementRecipientFilter(c.Param("id"), auth.UserID(c))
	var rec model.Announcement
	if err := s.Store.Announcements().FindOne(ctx, filter,
		options.FindOne().SetProjection(bson.M{"recipients": 0})).Decode(&rec); err != nil {
		failCode(c, 404, "公告不存在或无权查看")
		return
	}
	ok(c, rec)
}

func (s *Server) ReadAnnouncement(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	id, uid := c.Param("id"), auth.UserID(c)
	now := time.Now().UnixMilli()
	filter := s.announcementRecipientFilter(id, uid)
	filter["recipients"] = bson.M{"$elemMatch": bson.M{
		"user_id": uid, "read_at": bson.M{"$exists": false},
	}}
	result, err := s.Store.Announcements().UpdateOne(ctx, filter, bson.M{"$set": bson.M{"recipients.$.read_at": now}})
	if err != nil {
		fail(c, "保存阅读回执失败")
		return
	}
	if result.MatchedCount == 0 {
		var rec model.Announcement
		if err := s.Store.Announcements().FindOne(ctx, s.announcementRecipientFilter(id, uid),
			options.FindOne().SetProjection(bson.M{"recipients.$": 1})).Decode(&rec); err != nil || len(rec.Recipients) != 1 {
			failCode(c, 404, "公告不存在或无权查看")
			return
		}
		now = rec.Recipients[0].ReadAt
	}
	_, _ = s.Store.Notifications().UpdateMany(ctx, bson.M{
		"company_id": s.Cfg.CompanyID, "user_id": uid, "kind": "announcement", "path": announcementPath(id), "read": false,
	}, bson.M{"$set": bson.M{"read": true, "read_at": now}})
	ok(c, gin.H{"read_at": now})
}
