package store

import (
	"context"
	"log"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type Store struct {
	Client *mongo.Client
	DB     *mongo.Database
}

func Connect(uri, dbName string) (*Store, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cli, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		return nil, err
	}
	if err = cli.Ping(ctx, nil); err != nil {
		return nil, err
	}
	return &Store{Client: cli, DB: cli.Database(dbName)}, nil
}

// 集合统一 oa_ 前缀，与 IM 核心集合物理隔离，方便单独备份与升级。
func (s *Store) Checkins() *mongo.Collection  { return s.DB.Collection("oa_checkin") }
func (s *Store) Reports() *mongo.Collection   { return s.DB.Collection("oa_report") }
func (s *Store) Employees() *mongo.Collection { return s.DB.Collection("oa_employee") }
func (s *Store) Files() *mongo.Collection     { return s.DB.Collection("oa_file") }
func (s *Store) Leaves() *mongo.Collection    { return s.DB.Collection("oa_leave") }
func (s *Store) Makeups() *mongo.Collection   { return s.DB.Collection("oa_makeup") }
func (s *Store) Exceptions() *mongo.Collection {
	return s.DB.Collection("oa_checkin_exception")
}
func (s *Store) Rules() *mongo.Collection         { return s.DB.Collection("oa_attendance_rule") }
func (s *Store) Notifications() *mongo.Collection { return s.DB.Collection("oa_notification") }

// 以下两个是 IM 的核心集合，只读引用（不写入）。
// 员工管理页挑人时直接读 IM 已注册账号，避免在 OA 里重复建一套账号体系。
func (s *Store) IMUsers() *mongo.Collection      { return s.DB.Collection("user") }
func (s *Store) IMAttributes() *mongo.Collection { return s.DB.Collection("attribute") }

// EnsureIndexes 建索引。company_id 一律作为联合索引首列（多租户铁律）。
func (s *Store) EnsureIndexes(ctx context.Context) error {
	if err := s.ensureAnnouncementIndexes(ctx); err != nil {
		return err
	}
	if err := s.ensureAuditIndexes(ctx); err != nil {
		return err
	}
	if err := s.ensureContractIndexes(ctx); err != nil {
		return err
	}
	if err := s.ensureDepartmentIndexes(ctx); err != nil {
		return err
	}
	if err := s.ensureRuleRevisionIndexes(ctx); err != nil {
		return err
	}
	_, err := s.Checkins().Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "company_id", Value: 1}, {Key: "user_id", Value: 1}, {Key: "date", Value: 1}, {Key: "type", Value: 1}},
		Options: options.Index().SetUnique(true),
	})
	if err != nil {
		return err
	}
	if _, err = s.Reports().Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{{Key: "company_id", Value: 1}, {Key: "author.user_id", Value: 1}, {Key: "period", Value: 1}},
	}); err != nil {
		return err
	}
	if _, err = s.Reports().Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{{Key: "company_id", Value: 1}, {Key: "status", Value: 1}},
	}); err != nil {
		return err
	}
	_, err = s.Employees().Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "company_id", Value: 1}, {Key: "user_id", Value: 1}},
		Options: options.Index().SetUnique(true),
	})
	if err != nil {
		return err
	}
	_, err = s.Files().Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "company_id", Value: 1}, {Key: "file_id", Value: 1}},
		Options: options.Index().SetUnique(true),
	})
	if err != nil {
		return err
	}
	// 按上传人查（"这个人的附件/照片"），以及后续按 scope 清理孤儿文件
	_, err = s.Files().Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{{Key: "company_id", Value: 1}, {Key: "owner_id", Value: 1}, {Key: "created_at", Value: -1}},
	})
	if err != nil {
		return err
	}
	// 请假：按申请人 + 状态查（我的申请 / 待我审批），按日期查（统计口径合并）
	if _, err = s.Leaves().Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{{Key: "company_id", Value: 1}, {Key: "user_id", Value: 1}, {Key: "status", Value: 1}},
	}); err != nil {
		return err
	}
	if _, err = s.Leaves().Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{{Key: "company_id", Value: 1}, {Key: "start_date", Value: 1}, {Key: "end_date", Value: 1}},
	}); err != nil {
		return err
	}
	// 补卡：同一天同一类型只允许一条（pending/approved 都算，"已拒绝/已撤销"可重新申请）
	if _, err = s.Makeups().Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "company_id", Value: 1}, {Key: "user_id", Value: 1}, {Key: "date", Value: 1}, {Key: "type", Value: 1}, {Key: "status", Value: 1}},
		Options: options.Index().SetUnique(true),
	}); err != nil {
		return err
	}
	// 补卡记录回查，以及后台恢复已领取但未完成的审批。
	if _, err = s.Makeups().Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "company_id", Value: 1}, {Key: "makeup_id", Value: 1}}},
		{
			Keys: bson.D{{Key: "company_id", Value: 1}, {Key: "status", Value: 1}, {Key: "approval_claim.claimed_at", Value: 1}},
			Options: options.Index().SetPartialFilterExpression(bson.M{"approval_claim": bson.M{"$exists": true}}),
		},
	}); err != nil {
		return err
	}
	// 考勤异常：同一人同一天同一类型只有一条，扫描重复跑靠它做幂等
	if _, err = s.Exceptions().Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "company_id", Value: 1}, {Key: "user_id", Value: 1}, {Key: "date", Value: 1}, {Key: "kind", Value: 1}},
		Options: options.Index().SetUnique(true),
	}); err != nil {
		return err
	}
	// 按状态 + 月份查待处理（工作台、审批中心、异常列表都走这个顺序）
	if _, err = s.Exceptions().Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{{Key: "company_id", Value: 1}, {Key: "status", Value: 1}, {Key: "date", Value: -1}},
	}); err != nil {
		return err
	}
	// 考勤规则：一家公司一条
	if _, err = s.Rules().Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "company_id", Value: 1}},
		Options: options.Index().SetUnique(true),
	}); err != nil {
		return err
	}
	// 通知：按人查未读、按人查列表
	if _, err = s.Notifications().Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{{Key: "company_id", Value: 1}, {Key: "user_id", Value: 1}, {Key: "read", Value: 1}, {Key: "created_at", Value: -1}},
	}); err != nil {
		return err
	}
	return err
}

// SeedEmployees 只向员工集合中没有该公司记录的测试公司写入演示账号。
func (s *Store) SeedEmployees(ctx context.Context, companyID string) error {
	employees := s.Employees()
	count, err := employees.CountDocuments(ctx, bson.M{"company_id": companyID}, options.Count().SetLimit(1))
	if err != nil || count != 0 {
		return err
	}
	seeds := []any{
		bson.M{"company_id": companyID, "user_id": "2158780278", "real_name": "李然", "department": "技术部", "position": "前端工程师", "manager_id": "9283941092", "role": "employee", "is_admin": false},
		bson.M{"company_id": companyID, "user_id": "7474479331", "real_name": "张明", "department": "技术部", "position": "后端工程师", "manager_id": "9283941092", "role": "employee", "is_admin": false},
		bson.M{"company_id": companyID, "user_id": "9283941092", "real_name": "王强", "department": "技术部", "position": "技术组长", "manager_id": "7559659175", "role": "manager", "is_admin": false},
		bson.M{"company_id": companyID, "user_id": "7559659175", "real_name": "王经理", "department": "技术部", "position": "部门经理", "manager_id": "", "role": "leader", "is_admin": true},
	}
	for _, doc := range seeds {
		m := doc.(bson.M)
		m["oa_test_marker"] = "demo-employees-v1"
		m["disabled"] = false
		filter := bson.M{"company_id": companyID, "user_id": m["user_id"]}
		update := bson.M{"$setOnInsert": m}
		if _, err := employees.UpdateOne(ctx, filter, update, options.Update().SetUpsert(true)); err != nil {
			return err
		}
	}
	log.Printf("[seed] demo employees ensured: %d", len(seeds))
	return nil
}
