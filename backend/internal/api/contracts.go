package api

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/xinbo/xinbo-oa/internal/auth"
	"github.com/xinbo/xinbo-oa/internal/model"
)

const contractReminderDays = 30

func (s *Server) contractFilter(employeeID string) bson.M {
	return bson.M{"company_id": s.Cfg.CompanyID, "employee_id": employeeID}
}

func contractStatus(start, end string, now time.Time) string {
	today := todayStr(now)
	switch {
	case end < today:
		return "expired"
	case start > today:
		return "upcoming"
	case end <= todayStr(now.AddDate(0, 0, contractReminderDays)):
		return "expiring"
	default:
		return "active"
	}
}

func (s *Server) EmployeeContract(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	if !s.isAdmin(ctx, auth.UserID(c)) {
		failCode(c, 403, "无权查看员工合同")
		return
	}
	employeeID := strings.TrimSpace(c.Query("employee_id"))
	if employeeID == "" || s.getEmployee(ctx, employeeID) == nil {
		fail(c, "员工不存在")
		return
	}
	var contract model.EmployeeContract
	err := s.Store.EmployeeContracts().FindOne(ctx, s.contractFilter(employeeID)).Decode(&contract)
	if errors.Is(err, mongo.ErrNoDocuments) {
		ok(c, nil)
		return
	}
	if err != nil {
		fail(c, "查询合同失败")
		return
	}
	contract.Status = contractStatus(contract.StartDate, contract.EndDate, time.Now())
	ok(c, contract)
}

func (s *Server) SaveEmployeeContract(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
	defer cancel()
	uid := auth.UserID(c)
	if !s.isAdmin(ctx, uid) {
		failCode(c, 403, "无权维护员工合同")
		return
	}
	var req struct {
		EmployeeID    string   `json:"employee_id"`
		StartDate     string   `json:"start_date"`
		EndDate       string   `json:"end_date"`
		AttachmentIDs []string `json:"attachment_ids"`
		UpdatedAt     *int64   `json:"updated_at"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, "参数错误")
		return
	}
	start, errStart := time.Parse("2006-01-02", req.StartDate)
	end, errEnd := time.Parse("2006-01-02", req.EndDate)
	if errStart != nil || errEnd != nil || start.After(end) {
		fail(c, "合同起止日期不正确")
		return
	}
	req.EmployeeID = strings.TrimSpace(req.EmployeeID)
	if req.EmployeeID == "" || s.getEmployee(ctx, req.EmployeeID) == nil {
		fail(c, "员工不存在")
		return
	}

	filter := s.contractFilter(req.EmployeeID)
	var prior model.EmployeeContract
	err := s.Store.EmployeeContracts().FindOne(ctx, filter).Decode(&prior)
	creating := errors.Is(err, mongo.ErrNoDocuments)
	if err != nil && !creating {
		fail(c, "查询合同失败")
		return
	}
	if req.UpdatedAt != nil && *req.UpdatedAt != prior.UpdatedAt {
		fail(c, "合同已更新，请重新打开后再保存")
		return
	}

	const maxContractAttachments = 5
	if len(req.AttachmentIDs) > maxContractAttachments {
		fail(c, fmt.Sprintf("一份合同最多 %d 个附件", maxContractAttachments))
		return
	}
	attachments := prior.Attachments
	if req.AttachmentIDs != nil {
		attachments = make([]model.ContractAttachment, 0, len(req.AttachmentIDs))
		retained := make(map[string]bool, len(prior.Attachments))
		for _, attachment := range prior.Attachments {
			retained[attachment.FileID] = true
		}
		seen := make(map[string]bool, len(req.AttachmentIDs))
		for _, id := range req.AttachmentIDs {
			meta := s.loadFile(ctx, id)
			if seen[id] || meta == nil || meta.Scope != fileScopeContract || meta.ContractEmployeeID != req.EmployeeID ||
				(meta.OwnerID != uid && !retained[id]) {
				fail(c, "合同附件无效，请重新上传")
				return
			}
			seen[id] = true
			attachments = append(attachments, model.ContractAttachment{FileID: meta.ID, Name: meta.Name})
		}
	}

	now := time.Now()
	contract := model.EmployeeContract{
		CompanyID: s.Cfg.CompanyID, EmployeeID: req.EmployeeID,
		StartDate: req.StartDate, EndDate: req.EndDate, Attachments: attachments,
		UpdatedBy: uid, UpdatedAt: max(now.UnixMilli(), prior.UpdatedAt+1),
		Status: contractStatus(req.StartDate, req.EndDate, now),
	}
	if creating {
		_, err = s.Store.EmployeeContracts().InsertOne(ctx, contract)
	} else {
		filter["updated_at"] = prior.UpdatedAt
		updated, updateErr := s.Store.EmployeeContracts().ReplaceOne(ctx, filter, contract)
		err = updateErr
		if err == nil && updated.MatchedCount == 0 {
			fail(c, "合同已更新，请重新打开后再保存")
			return
		}
	}
	if err != nil {
		s.recordOperationAudit(ctx, uid, auditContractSave, req.EmployeeID, auditResultFailed)
		if mongo.IsDuplicateKeyError(err) {
			fail(c, "合同已创建，请重新打开后再保存")
		} else {
			fail(c, "保存合同失败")
		}
		return
	}
	s.recordOperationAudit(ctx, uid, auditContractSave, req.EmployeeID, auditResultSuccess,
		auditChange("start_date", prior.StartDate, req.StartDate),
		auditChange("end_date", prior.EndDate, req.EndDate),
		auditChange("attachment_count", len(prior.Attachments), len(attachments)),
	)
	ok(c, contract)
}

func (s *Server) canReadContractAttachment(ctx context.Context, uid, employeeID string, meta *model.FileMeta) bool {
	if employeeID == "" || meta.ContractEmployeeID != employeeID || !s.isAdmin(ctx, uid) {
		return false
	}
	filter := s.contractFilter(employeeID)
	filter["attachments.file_id"] = meta.ID
	return s.Store.EmployeeContracts().FindOne(ctx, filter).Err() == nil
}

func (s *Server) runContractExpiryReminders() {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if err := s.sendContractExpiryReminders(ctx, time.Now()); err != nil {
		log.Print("[contracts] expiry reminder scan failed")
	}
}

func (s *Server) sendContractExpiryReminders(ctx context.Context, now time.Time) error {
	contracts, err := s.Store.EmployeeContracts().Find(ctx, bson.M{
		"company_id": s.Cfg.CompanyID,
		"end_date":   bson.M{"$gte": todayStr(now), "$lte": todayStr(now.AddDate(0, 0, contractReminderDays))},
	})
	if err != nil {
		return err
	}
	var expiring []model.EmployeeContract
	if err := contracts.All(ctx, &expiring); err != nil || len(expiring) == 0 {
		return err
	}
	admins, err := s.Store.Employees().Find(ctx, bson.M{
		"company_id": s.Cfg.CompanyID, "disabled": bson.M{"$ne": true},
		"$or": bson.A{bson.M{"is_admin": true}, bson.M{"role": bson.M{"$in": []string{"hr", "admin"}}}},
	}, options.Find().SetProjection(bson.M{"user_id": 1}))
	if err != nil {
		return err
	}
	var recipients []model.Employee
	if err := admins.All(ctx, &recipients); err != nil {
		return err
	}

	var notifyErr error
	for _, contract := range expiring {
		employee := s.getEmployee(ctx, contract.EmployeeID)
		if employee == nil {
			continue
		}
		key := contract.EmployeeID + ":" + contract.EndDate
		link := "/oa-admin?contract_employee_id=" + url.QueryEscape(contract.EmployeeID)
		for _, recipient := range recipients {
			_, err := s.notifyOnce(ctx, recipient.UserID, "contract_expiry", key, "员工合同即将到期",
				fmt.Sprintf("%s 的合同将于 %s 到期，请查看并处理。", employee.RealName, contract.EndDate), link)
			notifyErr = errors.Join(notifyErr, err)
		}
	}
	return notifyErr
}
