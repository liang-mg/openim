package api

import (
	"context"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/xinbo/xinbo-oa/internal/auth"
	"github.com/xinbo/xinbo-oa/internal/model"
)

const (
	auditEmployeeUpdate  = "employee_update"
	auditEmployeeDisable = "employee_disable"
	auditDepartmentSave  = "department_save"
	auditDepartmentLink  = "department_migrate"
	auditCheckinCorrect  = "checkin_correct"
	auditExceptionHandle = "exception_handle"
	auditReportRead      = "report_read"
	auditContractSave    = "contract_save"
	auditResultSuccess   = "success"
	auditResultDenied    = "denied"
	auditResultFailed    = "failed"
	auditResultPartial   = "partial"
)

func auditValue(value any) any {
	if text, ok := value.(string); ok {
		runes := []rune(text)
		if len(runes) > 128 {
			return string(runes[:128])
		}
	}
	return value
}

func auditChange(field string, before, after any) model.OperationAuditChange {
	return model.OperationAuditChange{Field: field, Before: auditValue(before), After: auditValue(after)}
}

func employeeAuditChanges(existing *model.Employee, set bson.M) []model.OperationAuditChange {
	var prior model.Employee
	if existing != nil {
		prior = *existing
	}
	fields := []struct {
		field string
		value any
	}{
		{"real_name", prior.RealName},
		{"department", prior.Department},
		{"department_id", prior.DepartmentID},
		{"position", prior.Position},
		{"role", prior.Role},
		{"manager_id", prior.ManagerID},
		{"is_admin", prior.IsAdmin},
	}
	var changes []model.OperationAuditChange
	for _, field := range fields {
		if after, exists := set[field.field]; exists && after != field.value {
			changes = append(changes, auditChange(field.field, field.value, after))
		}
	}
	return changes
}

func (s *Server) newOperationAudit(actor, action, target, result string, changes []model.OperationAuditChange) model.OperationAudit {
	return model.OperationAudit{
		ID: primitive.NewObjectID().Hex(), CompanyID: s.Cfg.CompanyID,
		ActorID: actor, OccurredAt: time.Now().UnixMilli(), Action: action,
		TargetID: target, Result: result, Changes: changes,
	}
}

func (s *Server) recordOperationAudit(ctx context.Context, actor, action, target, result string, changes ...model.OperationAuditChange) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	defer cancel()
	if _, err := s.Store.OperationsAudit().InsertOne(ctx, s.newOperationAudit(actor, action, target, result, changes)); err != nil {
		log.Printf("[audit] failed to persist %s event", action)
	}
}

// The review endpoints return the full reports, so record every returned report ID.
func (s *Server) auditReportReads(ctx context.Context, actor string, reports []reportForReview) {
	if len(reports) == 0 {
		return
	}
	events := make([]any, 0, len(reports))
	for _, report := range reports {
		events = append(events, s.newOperationAudit(actor, auditReportRead, report.ID, auditResultSuccess, nil))
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	defer cancel()
	if _, err := s.Store.OperationsAudit().InsertMany(ctx, events); err != nil {
		log.Print("[audit] failed to persist report read events")
	}
}

func (s *Server) AuditList(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	if !s.isAdmin(ctx, auth.UserID(c)) {
		failCode(c, 403, "无权查看操作审计")
		return
	}

	filter := bson.M{"company_id": s.Cfg.CompanyID}
	for _, field := range []string{"actor_id", "action"} {
		if value := strings.TrimSpace(c.Query(field)); value != "" {
			filter[field] = value
		}
	}
	times := bson.M{}
	from, to := c.Query("from"), c.Query("to")
	if from != "" {
		start, err := time.ParseInLocation("2006-01-02", from, time.Local)
		if err != nil {
			fail(c, "起始日期不正确")
			return
		}
		times["$gte"] = start.UnixMilli()
	}
	if to != "" {
		end, err := time.ParseInLocation("2006-01-02", to, time.Local)
		if err != nil || from != "" && to < from {
			fail(c, "结束日期不正确")
			return
		}
		times["$lt"] = end.AddDate(0, 0, 1).UnixMilli()
	}
	if len(times) > 0 {
		filter["occurred_at"] = times
	}
	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	if err != nil || page < 1 || page > 1000000 {
		fail(c, "页码不正确")
		return
	}
	const pageSize = 30
	total, err := s.Store.OperationsAudit().CountDocuments(ctx, filter)
	if err != nil {
		fail(c, "查询审计记录失败")
		return
	}
	cur, err := s.Store.OperationsAudit().Find(ctx, filter, options.Find().
		SetSort(bson.D{{Key: "occurred_at", Value: -1}, {Key: "audit_id", Value: -1}}).
		SetSkip(int64(page-1)*pageSize).SetLimit(pageSize))
	if err != nil {
		fail(c, "查询审计记录失败")
		return
	}
	list := []model.OperationAudit{}
	if err := cur.All(ctx, &list); err != nil {
		fail(c, "查询审计记录失败")
		return
	}
	ok(c, gin.H{"total": total, "list": list, "page_size": pageSize})
}
