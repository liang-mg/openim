package store

import (
	"context"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

func (s *Store) OperationsAudit() *mongo.Collection { return s.DB.Collection("oa_operation_audit") }

func (s *Store) ensureAuditIndexes(ctx context.Context) error {
	_, err := s.OperationsAudit().Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "company_id", Value: 1}, {Key: "occurred_at", Value: -1}, {Key: "audit_id", Value: -1}}},
		{Keys: bson.D{{Key: "company_id", Value: 1}, {Key: "actor_id", Value: 1}, {Key: "occurred_at", Value: -1}, {Key: "audit_id", Value: -1}}},
		{Keys: bson.D{{Key: "company_id", Value: 1}, {Key: "action", Value: 1}, {Key: "occurred_at", Value: -1}, {Key: "audit_id", Value: -1}}},
	})
	return err
}
