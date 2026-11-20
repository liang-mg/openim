package model

type ContractAttachment struct {
	FileID string `json:"file_id" bson:"file_id"`
	Name   string `json:"name" bson:"name"`
}

type EmployeeContract struct {
	CompanyID   string               `json:"-" bson:"company_id"`
	EmployeeID  string               `json:"employee_id" bson:"employee_id"`
	StartDate   string               `json:"start_date" bson:"start_date"`
	EndDate     string               `json:"end_date" bson:"end_date"`
	Attachments []ContractAttachment `json:"attachments,omitempty" bson:"attachments,omitempty"`
	UpdatedBy   string               `json:"updated_by" bson:"updated_by"`
	UpdatedAt   int64                `json:"updated_at" bson:"updated_at"`
	Status      string               `json:"status" bson:"-"`
}
