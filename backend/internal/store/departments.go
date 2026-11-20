package store

import (
	"context"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func (s *Store) Departments() *mongo.Collection { return s.DB.Collection("oa_department") }

func (s *Store) ensureDepartmentIndexes(ctx context.Context) error {
	_, err := s.Departments().Indexes().CreateMany(ctx, []mongo.IndexModel{
		{
			Keys:    bson.D{{Key: "company_id", Value: 1}, {Key: "department_id", Value: 1}},
			Options: options.Index().SetUnique(true),
		},
		{
			Keys:    bson.D{{Key: "company_id", Value: 1}, {Key: "parent_id", Value: 1}, {Key: "name", Value: 1}},
			Options: options.Index().SetUnique(true),
		},
		{
			Keys: bson.D{{Key: "company_id", Value: 1}, {Key: "head_id", Value: 1}},
		},
	})
	if err != nil {
		return err
	}
	approverIndex := mongo.IndexModel{
		Keys: bson.D{{Key: "company_id", Value: 1}, {Key: "approver_id", Value: 1}},
	}
	for _, collection := range []*mongo.Collection{s.Leaves(), s.Makeups()} {
		if _, err := collection.Indexes().CreateOne(ctx, approverIndex); err != nil {
			return err
		}
	}
	return nil
}
