package model

type OperationAuditChange struct {
	Field  string `bson:"field" json:"field"`
	Before any    `bson:"before,omitempty" json:"before,omitempty"`
	After  any    `bson:"after,omitempty" json:"after,omitempty"`
}

type OperationAudit struct {
	ID         string                 `bson:"audit_id" json:"audit_id"`
	CompanyID  string                 `bson:"company_id" json:"-"`
	ActorID    string                 `bson:"actor_id" json:"actor_id"`
	OccurredAt int64                  `bson:"occurred_at" json:"occurred_at"`
	Action     string                 `bson:"action" json:"action"`
	TargetID   string                 `bson:"target_id" json:"target_id"`
	Result     string                 `bson:"result" json:"result"`
	Changes    []OperationAuditChange `bson:"changes,omitempty" json:"changes,omitempty"`
}
