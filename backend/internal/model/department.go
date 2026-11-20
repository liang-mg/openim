package model

type Department struct {
	ID        string `json:"department_id" bson:"department_id"`
	CompanyID string `json:"-" bson:"company_id"`
	Name      string `json:"name" bson:"name"`
	ParentID  string `json:"parent_id" bson:"parent_id"`
	HeadID    string `json:"head_id" bson:"head_id"`
}
