package store

import (
	"context"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

func (s *Store) RuleRevisions() *mongo.Collection {
	return s.DB.Collection("oa_attendance_rule_revision")
}

func (s *Store) ensureRuleRevisionIndexes(ctx context.Context) error {
	_, err := s.RuleRevisions().Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{{Key: "company_id", Value: 1}, {Key: "effective_date", Value: -1}, {Key: "updated_at", Value: -1}, {Key: "_id", Value: -1}},
	})
	return err
}
