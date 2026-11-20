package model

type AnnouncementRecipient struct {
	UserID string `json:"user_id" bson:"user_id"`
	Name   string `json:"name" bson:"name"`
	ReadAt int64  `json:"read_at,omitempty" bson:"read_at,omitempty"`
}

type Announcement struct {
	ID             string                  `json:"announcement_id" bson:"_id"`
	CompanyID      string                  `json:"-" bson:"company_id"`
	PublisherID    string                  `json:"-" bson:"publisher_id"`
	PublisherName  string                  `json:"publisher_name" bson:"publisher_name"`
	Title          string                  `json:"title" bson:"title"`
	Content        string                  `json:"content,omitempty" bson:"content"`
	Scope          string                  `json:"scope" bson:"scope"`
	DepartmentID   string                  `json:"department_id,omitempty" bson:"department_id,omitempty"`
	DepartmentName string                  `json:"department_name,omitempty" bson:"department_name,omitempty"`
	PublishedAt    int64                   `json:"published_at" bson:"published_at"`
	Recipients     []AnnouncementRecipient `json:"-" bson:"recipients"`
}
