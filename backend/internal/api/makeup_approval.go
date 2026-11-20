package api

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/xinbo/xinbo-oa/internal/model"
)

var (
	errMakeupProcessed = errors.New("该申请已处理")
	errMakeupClaimed   = errors.New("此补卡申请正在审批")
	errCheckinOccupied = errors.New("该时段已有打卡记录，不能重复补卡")
)

func (s *Server) pendingMakeupFilter(id string) bson.M {
	return bson.M{"company_id": s.Cfg.CompanyID, "makeup_id": id, "status": "pending"}
}

func (s *Server) claimMakeupApproval(ctx context.Context, rec model.MakeupRequest, uid, name, comment string) (model.MakeupRequest, error) {
	rule, err := s.attendanceRuleForDate(ctx, rec.UserID, rec.Date)
	if err != nil {
		return rec, err
	}
	ts, err := time.ParseInLocation("2006-01-02 15:04", rec.Date+" "+rec.Time, time.Local)
	if err != nil {
		return rec, err
	}
	status, statusText := "normal", "正常"
	min := parseHM(rec.Time)
	if isWorkday(rec.Date, rule.Workdays) {
		if rec.Type == "on" && min > parseHM(rule.WorkOnTime)+rule.LateGrace {
			status, statusText = "late", "迟到"
		} else if rec.Type == "off" && min < parseHM(rule.WorkOffTime) {
			status, statusText = "early", "早退"
		}
	}
	now := time.Now().UnixMilli()
	claim := model.MakeupApprovalClaim{
		ActorID: uid, ActorName: name, Comment: comment, ClaimedAt: now,
		Checkin: model.CheckinRecord{
			ID: primitive.NewObjectID().Hex(), CompanyID: s.Cfg.CompanyID, UserID: rec.UserID,
			Date: rec.Date, Type: rec.Type, CheckinTime: ts.UnixMilli(), Status: status, StatusText: statusText,
			Source: "makeup", MakeupID: rec.ID, CreatedAt: now, RuleSnapshot: &rule,
		},
	}
	filter := s.pendingMakeupFilter(rec.ID)
	filter["approval_claim"] = bson.M{"$exists": false}
	err = s.Store.Makeups().FindOneAndUpdate(ctx, filter, bson.M{"$set": bson.M{"approval_claim": claim}},
		options.FindOneAndUpdate().SetReturnDocument(options.After),
	).Decode(&rec)
	if errors.Is(err, mongo.ErrNoDocuments) {
		err = s.Store.Makeups().FindOne(ctx, bson.M{"company_id": s.Cfg.CompanyID, "makeup_id": rec.ID}).Decode(&rec)
	}
	return rec, err
}

func (s *Server) completeMakeupApproval(ctx context.Context, rec model.MakeupRequest) error {
	claim := rec.ApprovalClaim
	card := claim.Checkin
	slot := bson.M{"company_id": s.Cfg.CompanyID, "user_id": rec.UserID, "date": rec.Date, "type": rec.Type}
	var stored model.CheckinRecord
	err := s.Store.Checkins().FindOneAndUpdate(ctx, slot,
		bson.M{"$setOnInsert": card},
		options.FindOneAndUpdate().SetUpsert(true).SetReturnDocument(options.After),
	).Decode(&stored)
	if mongo.IsDuplicateKeyError(err) {
		err = s.Store.Checkins().FindOne(ctx, slot).Decode(&stored)
	}
	if err != nil {
		return err
	}

	filter := s.pendingMakeupFilter(rec.ID)
	filter["approval_claim.checkin.checkin_id"] = card.ID
	filter["approval_claim.actor_id"] = claim.ActorID
	clearClaim := bson.M{"approval_claim": ""}
	if stored.ID != card.ID || stored.MakeupID != rec.ID || stored.Source != "makeup" {
		if _, err := s.Store.Makeups().UpdateOne(ctx, filter, bson.M{"$unset": clearClaim}); err != nil {
			return err
		}
		s.recordOperationAudit(ctx, claim.ActorID, auditCheckinCorrect, rec.ID, auditResultFailed)
		return errCheckinOccupied
	}

	now := time.Now().UnixMilli()
	res, err := s.Store.Makeups().UpdateOne(ctx, filter, bson.M{
		"$set": bson.M{
			"status": "approved", "comment": claim.Comment, "approver_id": claim.ActorID, "approver_name": claim.ActorName,
			"approved_at": now, "updated_at": now, "checkin_id": card.ID,
		},
		"$unset": clearClaim,
	})
	if err != nil {
		return err
	}
	if res.ModifiedCount == 0 {
		// 同一审批可能已经被另一个请求或定时任务完成。
		err := s.Store.Makeups().FindOne(ctx, bson.M{
			"company_id": s.Cfg.CompanyID, "makeup_id": rec.ID, "status": "approved",
			"approver_id": claim.ActorID, "checkin_id": card.ID,
		}).Err()
		if errors.Is(err, mongo.ErrNoDocuments) {
			return errMakeupProcessed
		}
		return err
	}

	s.recordOperationAudit(ctx, claim.ActorID, auditCheckinCorrect, card.ID, auditResultSuccess,
		auditChange("user_id", nil, rec.UserID), auditChange("makeup_id", nil, rec.ID),
		auditChange("date", nil, rec.Date), auditChange("type", nil, rec.Type),
		auditChange("time", nil, rec.Time), auditChange("status", nil, stored.Status))
	s.notifyMakeupResult(ctx, rec, "已通过", claim.Comment)
	kinds := []string{model.ExcAbsent}
	if rec.Type == "on" {
		kinds = append(kinds, model.ExcMissingOn)
	} else {
		kinds = append(kinds, model.ExcMissingOff)
	}
	s.autoResolveException(ctx, rec.UserID, rec.Date, kinds, "补卡审批通过，自动核销")
	return nil
}

func (s *Server) notifyMakeupResult(ctx context.Context, rec model.MakeupRequest, result, comment string) {
	typeText := "上班卡"
	if rec.Type == "off" {
		typeText = "下班卡"
	}
	_ = s.notifyEvent(ctx, rec.UserID, "approval", "makeup:"+rec.ID,
		fmt.Sprintf("补卡申请%s", result), fmt.Sprintf("%s %s %s：%s", rec.Date, typeText, rec.Time, comment),
		approvalNotificationPath(TabMine, "makeup", rec.ID))
}

func (s *Server) runPendingMakeupApprovals() {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	cur, err := s.Store.Makeups().Find(ctx, bson.M{
		"company_id": s.Cfg.CompanyID, "status": "pending", "approval_claim": bson.M{"$exists": true},
	}, options.Find().SetSort(bson.D{{Key: "approval_claim.claimed_at", Value: 1}}).SetLimit(100))
	if err != nil {
		log.Print("[makeup] could not read pending approvals")
		return
	}
	var pending []model.MakeupRequest
	if err := cur.All(ctx, &pending); err != nil {
		log.Print("[makeup] could not read pending approvals")
		return
	}
	for _, rec := range pending {
		if rec.ApprovalClaim == nil {
			continue
		}
		if err := s.completeMakeupApproval(ctx, rec); err != nil &&
			!errors.Is(err, errCheckinOccupied) && !errors.Is(err, errMakeupProcessed) {
			log.Print("[makeup] deferred incomplete approval")
		}
	}
}

// loadVisibleCheckins only counts a makeup card once its matching request commits.
func (s *Server) loadVisibleCheckins(ctx context.Context, filter bson.M, opts ...*options.FindOptions) ([]model.CheckinRecord, error) {
	cursor, err := s.Store.Checkins().Find(ctx, filter, opts...)
	if err != nil {
		return nil, err
	}
	var records []model.CheckinRecord
	if err := cursor.All(ctx, &records); err != nil {
		return nil, err
	}
	var ids []string
	for _, card := range records {
		if card.Source == "makeup" && card.MakeupID != "" {
			ids = append(ids, card.MakeupID)
		}
	}
	approved := map[string]model.MakeupRequest{}
	if len(ids) > 0 {
		cur, err := s.Store.Makeups().Find(ctx, bson.M{
			"company_id": s.Cfg.CompanyID, "makeup_id": bson.M{"$in": ids}, "status": "approved",
		}, options.Find().SetProjection(bson.M{"makeup_id": 1, "checkin_id": 1, "user_id": 1, "date": 1, "type": 1}))
		if err != nil {
			return nil, err
		}
		var requests []model.MakeupRequest
		if err := cur.All(ctx, &requests); err != nil {
			return nil, err
		}
		for _, request := range requests {
			approved[request.ID] = request
		}
	}
	visible := records[:0]
	for _, card := range records {
		if card.Source == "makeup" {
			request, exists := approved[card.MakeupID]
			if !exists || request.CheckinID != card.ID || request.UserID != card.UserID ||
				request.Date != card.Date || request.Type != card.Type {
				continue
			}
		}
		visible = append(visible, card)
	}
	return visible, nil
}
