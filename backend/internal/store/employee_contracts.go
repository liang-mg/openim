package store

import (
	"context"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func (s *Store) EmployeeContracts() *mongo.Collection { return s.DB.Collection("oa_employee_contract") }

func (s *Store) ensureContractIndexes(ctx context.Context) error {
	_, err := s.EmployeeContracts().Indexes().CreateMany(ctx, []mongo.IndexModel{
		{
			Keys:    bson.D{{Key: "company_id", Value: 1}, {Key: "employee_id", Value: 1}},
			Options: options.Index().SetUnique(true),
		},
		{Keys: bson.D{{Key: "company_id", Value: 1}, {Key: "end_date", Value: 1}}},
	})
	return err
}
