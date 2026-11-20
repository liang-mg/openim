package store

import (
	"context"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

func (s *Store) Announcements() *mongo.Collection { return s.DB.Collection("oa_announcement") }

func (s *Store) ensureAnnouncementIndexes(ctx context.Context) error {
	_, err := s.Announcements().Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{{Key: "company_id", Value: 1}, {Key: "publisher_id", Value: 1}, {Key: "published_at", Value: -1}},
	})
	return err
}
