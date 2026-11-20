package model

// ============ 文件 ============

// FileMeta 只存元数据，真实内容在 MinIO 的 oa 桶里。
// ObjectKey 标 `json:"-"`：不下发前端，防止有人拼出存储地址绕过鉴权。
type FileMeta struct {
	ID        string `json:"file_id" bson:"file_id"`
	CompanyID string `json:"-" bson:"company_id"`
	OwnerID   string `json:"owner_id" bson:"owner_id"`
	Name      string `json:"name" bson:"name"`
	Size      int64  `json:"size" bson:"size"`
	Mime      string `json:"mime" bson:"mime"`
	ObjectKey string `json:"-" bson:"object_key"`
	Scope     string `json:"scope" bson:"scope"` // report / checkin / other
	CreatedAt int64  `json:"created_at" bson:"created_at"`

	ContractEmployeeID string `json:"-" bson:"contract_employee_id,omitempty"`
}

// ============ 打卡 ============

type CheckinRecord struct {
	ID           string  `json:"checkin_id" bson:"checkin_id"`
	CompanyID    string  `json:"-" bson:"company_id"`
	UserID       string  `json:"user_id" bson:"user_id"`
	Date         string  `json:"date" bson:"date"`
	Type         string  `json:"type" bson:"type"` // on / off
	CheckinTime  int64   `json:"checkin_time" bson:"checkin_time"`
	PhotoURL     string  `json:"photo_url,omitempty" bson:"photo_url,omitempty"`
	PhotoFileID  string  `json:"photo_file_id,omitempty" bson:"photo_file_id,omitempty"`
	LocationName string  `json:"location_name,omitempty" bson:"location_name,omitempty"`
	Address      string  `json:"address,omitempty" bson:"address,omitempty"` // 逆地理编码得到的可读地址
	Lat          float64 `json:"lat,omitempty" bson:"lat,omitempty"`
	Lng          float64 `json:"lng,omitempty" bson:"lng,omitempty"`
	// 距办公点的直线距离（米）与是否在打卡范围内。由服务端按 GPS 坐标算，前端只负责展示。
	// FenceSet=false 表示当时没有配置打卡点、没做范围判定，Distance 无意义。
	Distance   int    `json:"distance" bson:"distance"`
	InFence    bool   `json:"in_fence" bson:"in_fence"`
	FenceSet   bool   `json:"fence_set" bson:"fence_set"`
	Device     string `json:"device,omitempty" bson:"device,omitempty"`
	Status     string `json:"status" bson:"status"` // normal/late/early
	StatusText string `json:"status_text" bson:"status_text"`
	// Source 标明记录来源：normal=现场打卡 / makeup=补卡审批通过后生成。
	// 前端可据此显示"补卡"小标，但统计上都算一次真实出勤。
	Source       string          `json:"source" bson:"source"`
	MakeupID     string          `json:"makeup_id,omitempty" bson:"makeup_id,omitempty"`
	CreatedAt    int64           `json:"created_at" bson:"created_at"`
	RuleSnapshot *AttendanceRule `json:"rule_snapshot,omitempty" bson:"rule_snapshot,omitempty"`
}

// CheckinRule 作息规则，全部由服务端下发，前端只用于展示「几点上班」。
// 判定也在服务端做：前端改时间没有意义。
type CheckinRule struct {
	// WorkOnTime 上班时间（默认 09:05），晚于它打上班卡算迟到
	WorkOnTime string `json:"work_on_time"`
	// WorkOffTime 下班时间（默认 18:00），早于它打下班卡算早退
	WorkOffTime string `json:"work_off_time"`
	// LateGrace 迟到宽限分钟数
	LateGrace int `json:"late_grace"`
	// EarliestOn 最早可打上班卡的钟点，防止凌晨误触
	EarliestOn   string `json:"earliest_on"`
	NeedPhoto    bool   `json:"need_photo"`
	NeedLocation bool   `json:"need_location"`
	Workdays     []int  `json:"workdays"`
}

// OfficeInfo 打卡点，下发给前端用于展示「距离多少米」；
// 坐标只用于判定，不做地图渲染。Configured=false 表示还没有配打卡点。
type OfficeInfo struct {
	Name       string  `json:"name" bson:"name"`
	Address    string  `json:"address" bson:"address"`
	Lat        float64 `json:"lat" bson:"lat"`
	Lng        float64 `json:"lng" bson:"lng"`
	Radius     int     `json:"radius" bson:"radius"`
	Strict     bool    `json:"strict" bson:"strict"`
	Configured bool    `json:"configured" bson:"configured"`
}

// LocateResult 定位结果：坐标 + 可读地址 + 距打卡点距离
type LocateResult struct {
	Lat      float64    `json:"lat"`
	Lng      float64    `json:"lng"`
	Address  string     `json:"address"`
	Distance int        `json:"distance"`
	InFence  bool       `json:"in_fence"`
	FenceSet bool       `json:"fence_set"`
	Office   OfficeInfo `json:"office"`
}

type TodayCheckin struct {
	Date       string         `json:"date"`
	On         *CheckinRecord `json:"on"`
	Off        *CheckinRecord `json:"off"`
	CanCheckin bool           `json:"can_checkin"`
	Rule       CheckinRule    `json:"rule"`
	Office     OfficeInfo     `json:"office"`
}

// ============ 出勤（团队视角与报表） ============

// DayStatus 某个人某一天的状态，前端据此决定颜色和文案。
// rest 周末 / not_yet 还没到上班时间 / absent 该打卡没打 /
// in_progress 已上班未下班（**不算缺卡**）/ partial 只打了一次 / done 两次都打
type DayStatus struct {
	State string         `json:"state"`
	On    *CheckinRecord `json:"on"`
	Off   *CheckinRecord `json:"off"`
}

// MonthStat 某人本月（或指定月）的出勤统计。
// Workdays 是"应出勤天数"：工作日里已经过完的天数，未来日期不算，所以月中看不会虚高。
type MonthStat struct {
	Workdays int `json:"workdays"`
	Attend   int `json:"attend"`
	Late     int `json:"late"`
	Early    int `json:"early"`
	Absent   int `json:"absent"`
	Partial  int `json:"partial"`
	// Leave 已批准的请假日数（不算缺卡、不进应出勤分母）
	Leave int `json:"leave"`
	// Rate 出勤率（百分比，四舍五入），attend/workdays
	Rate int `json:"rate"`
}

// TeamMemberRow 团队考勤表的一行：今天来没来 + 本月表现。
type TeamMemberRow struct {
	UserID     string     `json:"user_id"`
	Name       string     `json:"name"`
	Department string     `json:"department"`
	Position   string     `json:"position"`
	Role       string     `json:"role"`
	Today      DayStatus  `json:"today"`
	Month      MonthStat  `json:"month"`
	Exception  bool       `json:"exception"` // 今日有异常，用于排序与「只看异常」过滤
}

// TeamCheckinSummary 团队当天的一行汇总，给组长一眼看规模。
type TeamCheckinSummary struct {
	Members int `json:"members"`
	Present int `json:"present"`
	Absent  int `json:"absent"`
	Late    int `json:"late"`
	Early   int `json:"early"`
}

type TeamCheckinResult struct {
	Scope    string              `json:"scope"`
	Month    string              `json:"month"`
	Date     string              `json:"date"`
	Rule     CheckinRule         `json:"rule"`
	Warnings []string            `json:"warnings"`
	Summary  TeamCheckinSummary  `json:"summary"`
	Members  []TeamMemberRow     `json:"members"`
}

// ReportRow 出勤报表的一行（一个人）。
type ReportRow struct {
	Makeup     int    `json:"makeup"`
	Exceptions int    `json:"exceptions"`
	UserID     string `json:"user_id"`
	Name       string `json:"name"`
	Department string `json:"department"`
	Position   string `json:"position"`
	Workdays   int    `json:"workdays"`
	Attend     int    `json:"attend"`
	Late       int    `json:"late"`
	Early      int    `json:"early"`
	Absent     int    `json:"absent"`
	Partial    int    `json:"partial"`
	Leave      int    `json:"leave"` // 本月已批准请假日数
	Rate       int    `json:"rate"`
	// AvgOn / AvgOff 平均上下班时间（HH:MM），没有记录时为空
	AvgOn  string `json:"avg_on"`
	AvgOff string `json:"avg_off"`
}

type AttendanceReport struct {
	Scope       string      `json:"scope"`
	Month       string      `json:"month"`
	Rule        CheckinRule `json:"rule"`
	GeneratedAt string      `json:"generated_at"`
	Warnings    []string    `json:"warnings"`
	Total       ReportRow   `json:"total"` // 合计行
	Rows        []ReportRow `json:"rows"`
}

// ============ 请假 / 补卡 ============

type LeaveAttachment struct {
	FileID string `json:"file_id" bson:"file_id"`
	Name   string `json:"name" bson:"name"`
}

// LeaveRequest 请假/出差申请：不可变记录，只改 status 不改内容。
// 批准不写 oa_checkin（请假日不是"打了卡"），只影响考勤统计口径。
type LeaveRequest struct {
	WorkDates []string `json:"-" bson:"work_dates,omitempty"`
	ID          string `json:"leave_id" bson:"leave_id"`
	CompanyID   string `json:"-" bson:"company_id"`
	UserID      string `json:"user_id" bson:"user_id"`
	UserName    string `json:"user_name" bson:"user_name"`
	Department  string `json:"department" bson:"department"`
	Type        string `json:"type" bson:"type"` // personal/sick/annual/compoff/business
	StartDate   string `json:"start_date" bson:"start_date"`
	EndDate     string `json:"end_date" bson:"end_date"`
	Days        int    `json:"days" bson:"days"` // 工作日天数，周末不计
	Reason      string `json:"reason" bson:"reason"`
	Status      string `json:"status" bson:"status"` // pending/approved/rejected/cancelled
	ApproverID  string `json:"approver_id" bson:"approver_id"`
	ApproverName string `json:"approver_name" bson:"approver_name"`
	Comment     string `json:"comment" bson:"comment"`
	SubmittedAt int64  `json:"submitted_at" bson:"submitted_at"`
	ApprovedAt  int64  `json:"approved_at" bson:"approved_at"`
	CreatedAt   int64  `json:"created_at" bson:"created_at"`
	UpdatedAt   int64  `json:"updated_at" bson:"updated_at"`

	Attachments []LeaveAttachment `json:"attachments,omitempty" bson:"attachments,omitempty"`
}

// MakeupRequest 补卡申请：批准后生成 source=makeup 的 oa_checkin 记录。
type MakeupRequest struct {
	ID           string `json:"makeup_id" bson:"makeup_id"`
	CompanyID    string `json:"-" bson:"company_id"`
	UserID       string `json:"user_id" bson:"user_id"`
	UserName     string `json:"user_name" bson:"user_name"`
	Department   string `json:"department" bson:"department"`
	Date         string `json:"date" bson:"date"`
	Type         string `json:"type" bson:"type"` // on/off
	Time         string `json:"time" bson:"time"` // HH:MM，补卡时间必须落在合理区间
	Reason       string `json:"reason" bson:"reason"`
	Status       string `json:"status" bson:"status"`
	ApproverID   string `json:"approver_id" bson:"approver_id"`
	ApproverName string `json:"approver_name" bson:"approver_name"`
	Comment      string `json:"comment" bson:"comment"`
	CheckinID    string `json:"checkin_id" bson:"checkin_id"` // 批准后生成的打卡记录 ID
	SubmittedAt  int64  `json:"submitted_at" bson:"submitted_at"`
	ApprovedAt   int64  `json:"approved_at" bson:"approved_at"`
	CreatedAt    int64  `json:"created_at" bson:"created_at"`
	UpdatedAt    int64  `json:"updated_at" bson:"updated_at"`

	ApprovalClaim *MakeupApprovalClaim `json:"-" bson:"approval_claim,omitempty"`
}

// LeaveDay 某人某月的请假日（已批准），给统计口径用
type LeaveDay struct {
	Date string `json:"date" bson:"date"`
	Type string `json:"type" bson:"type"`
}

// AttendancePending 工作台/审批中心共用的待办计数
type AttendancePending struct {
	Leave   int `json:"leave"`
	Makeup  int `json:"makeup"`
	Reports int `json:"reports"`
}

// ============ 考勤异常 ============

// 异常类型。判定口径与 dayStatusOf 保持一致，只写在 scanExceptionsFor 一处。
const (
	ExcAbsent       = "absent"        // 整日无卡
	ExcMissingOn    = "missing_on"    // 只有下班卡，缺上班卡
	ExcMissingOff   = "missing_off"   // 只有上班卡，缺下班卡
	ExcLate         = "late"          // 上班迟到
	ExcEarly        = "early"         // 下班早退
	ExcOutsideFence = "outside_fence" // 打卡点在允许范围外
)

// ExceptionKindText 异常类型的中文名，前端与导出共用，避免两边各写一份映射。
var ExceptionKindText = map[string]string{
	ExcAbsent:       "整日缺卡",
	ExcMissingOn:    "缺上班卡",
	ExcMissingOff:   "缺下班卡",
	ExcLate:         "迟到",
	ExcEarly:        "早退",
	ExcOutsideFence: "打卡位置异常",
}

// CheckinException 考勤异常：扫描生成，人工处理。
// 不可删，只改状态——年底核对时要有据可查。
type CheckinException struct {
	ID          string `json:"exception_id" bson:"exception_id"`
	CompanyID   string `json:"-" bson:"company_id"`
	UserID      string `json:"user_id" bson:"user_id"`
	UserName    string `json:"user_name" bson:"user_name"`
	Department  string `json:"department" bson:"department"`
	Date        string `json:"date" bson:"date"`
	Kind        string `json:"kind" bson:"kind"`
	KindText    string `json:"kind_text" bson:"kind_text"`
	Status      string `json:"status" bson:"status"` // open/appealed/resolved/ignored
	Note        string `json:"note" bson:"note"`     // 系统给的说明，例如「09:41 打卡，晚于 09:05」
	CheckinID   string `json:"checkin_id,omitempty" bson:"checkin_id,omitempty"`
	HandlerID   string `json:"handler_id,omitempty" bson:"handler_id,omitempty"`
	HandlerName string `json:"handler_name,omitempty" bson:"handler_name,omitempty"`
	HandledAt   int64  `json:"handled_at,omitempty" bson:"handled_at,omitempty"`
	Comment     string `json:"comment,omitempty" bson:"comment,omitempty"`
	CreatedAt   int64  `json:"created_at" bson:"created_at"`
	UpdatedAt   int64  `json:"updated_at" bson:"updated_at"`
}

type ExceptionSummary struct {
	Open     int `json:"open"`
	Appealed int `json:"appealed"`
	Resolved int `json:"resolved"`
	Ignored  int `json:"ignored"`
	Total    int `json:"total"`
}

type ExceptionListResult struct {
	Scope    string               `json:"scope"`
	Month    string               `json:"month"`
	Summary  ExceptionSummary     `json:"summary"`
	Total    int                  `json:"total"`
	List     []CheckinException   `json:"list"`
}

// ScanResult 一次扫描的结果，给手动触发的人看"补了几条/什么时候扫的"
type ScanResult struct {
	From    string `json:"from"`
	To      string `json:"to"`
	Scanned int    `json:"scanned"` // 检查了多少人天
	Created int    `json:"created"` // 新生成多少条
	Skipped int    `json:"skipped"` // 已存在而跳过
	Updated int    `json:"updated"` // 状态需要跟着记录变化的条数
}

// ============ 考勤规则（可配置，覆盖环境变量默认值） ============

// AttendanceRule 保存公司或部门的生效规则，无部门规则时使用公司规则。
type AttendanceRule struct {
	CompanyID    string `json:"-" bson:"company_id"`
	WorkOnTime   string `json:"work_on_time" bson:"work_on_time"`
	WorkOffTime  string `json:"work_off_time" bson:"work_off_time"`
	LateGrace    int    `json:"late_grace" bson:"late_grace"`
	EarliestOn   string `json:"earliest_on" bson:"earliest_on"`
	NeedPhoto    bool   `json:"need_photo" bson:"need_photo"`
	NeedLocation bool   `json:"need_location" bson:"need_location"`
	DepartmentID string `json:"department_id,omitempty" bson:"department_id"`
	EffectiveDate string `json:"effective_date,omitempty" bson:"effective_date"`
	Workdays []int `json:"workdays" bson:"workdays"`
	Office *OfficeInfo `json:"office,omitempty" bson:"office,omitempty"`
	// MakeupMaxDays / MakeupMaxMonth 补卡限制，0 表示不限
	MakeupMaxDays  int    `json:"makeup_max_days" bson:"makeup_max_days"`
	MakeupMaxMonth int    `json:"makeup_max_month" bson:"makeup_max_month"`
	UpdatedBy      string `json:"updated_by,omitempty" bson:"updated_by,omitempty"`
	UpdatedAt      int64  `json:"updated_at" bson:"updated_at"`
	// Source 标识这份规则来自数据库还是环境变量，前端页面据此提示"尚未保存过自定义规则"
	Source string `json:"source" bson:"-"`
}

// ============ 审批中心 ============

// ApprovalItem 审批中心的统一条目。四类申请各自有一张源表，
// 这里只做视图聚合，不落库——落一份副本迟早会和源表对不上。
type ApprovalItem struct {
	Kind      string `json:"kind"` // leave/makeup/exception/report
	KindText  string `json:"kind_text"`
	ID        string `json:"id"`
	UserID    string `json:"user_id"`
	UserName  string `json:"user_name"`
	Department string `json:"department"`
	Title     string `json:"title"`
	Subtitle  string `json:"subtitle"`
	Status    string `json:"status"`
	Time      int64  `json:"time"` // 提交时间，列表按它倒序
	CanApprove bool  `json:"can_approve"`
	Path      string `json:"path"`
}

type ApprovalListResult struct {
	Tab      string         `json:"tab"`
	Total    int            `json:"total"`
	List     []ApprovalItem `json:"list"`
	Pending  int            `json:"pending"` // 待我处理总数，工作台直接取这个
}

// SubmitRateRow 日报提交率的一行（按部门聚合）
type SubmitRateRow struct {
	Department string   `json:"department"`
	Total      int      `json:"total"`
	Submitted  int      `json:"submitted"`
	Rate       int      `json:"rate"`
	Missing    []string `json:"missing"` // 未提交的人名，只有能管人的人才有
}

type SubmitRateResult struct {
	Date  string          `json:"date"`
	Today string          `json:"today"`
	Scope string          `json:"scope"`
	Total int             `json:"total"`
	Done  int             `json:"done"`
	Rate  int             `json:"rate"`
	Rows  []SubmitRateRow `json:"rows"`
}

// ============ 站内通知 ============

// Notification 站内通知。IM 推送是同一条记录的"送达方式之一"，
// 推送失败不影响站内可见，避免用户两头都收不到。
type Notification struct {
	ID        string `json:"notification_id" bson:"notification_id"`
	CompanyID string `json:"-" bson:"company_id"`
	UserID    string `json:"user_id" bson:"user_id"`
	Kind      string `json:"kind" bson:"kind"` // approval/urge/exception/system
	Title     string `json:"title" bson:"title"`
	Content   string `json:"content" bson:"content"`
	Path      string `json:"path" bson:"path"`
	Read      bool   `json:"read" bson:"read"`
	CreatedAt int64  `json:"created_at" bson:"created_at"`
	ReadAt    int64  `json:"read_at,omitempty" bson:"read_at,omitempty"`
	IMStatus  string `json:"im_status,omitempty" bson:"im_status,omitempty"`
}

// ============ 日报 ============

type ReportContent struct {
	Done   string `json:"done" bson:"done"`
	Plan   string `json:"plan" bson:"plan"`
	Issues string `json:"issues" bson:"issues"`
}

type ReportAttachment struct {
	Name     string `json:"name" bson:"name"`
	Size     int64  `json:"size" bson:"size"`
	FileType string `json:"file_type" bson:"file_type"`
	URL      string `json:"url" bson:"url"`
}

type ReportAuthor struct {
	UserID     string `json:"user_id" bson:"user_id"`
	Name       string `json:"name" bson:"name"`
	Department string `json:"department" bson:"department"`
}

type ReviewInfo struct {
	ReviewerID   string `json:"reviewer_id,omitempty" bson:"reviewer_id,omitempty"`
	ReviewerName string `json:"reviewer_name" bson:"reviewer_name"`
	Role         string `json:"role" bson:"role"` // manager / leader
	Comment      string `json:"comment" bson:"comment"`
	ReviewTime   string `json:"review_time" bson:"review_time"`
}

type ReportRecord struct {
	ID          string             `json:"report_id" bson:"report_id"`
	CompanyID   string             `json:"-" bson:"company_id"`
	Type        string             `json:"type" bson:"type"`
	Period      string             `json:"period" bson:"period"`
	Content     ReportContent      `json:"content" bson:"content"`
	Attachments []ReportAttachment `json:"attachments" bson:"attachments"`
	Status      string             `json:"status" bson:"status"` // draft/submitted/pending_leader/archived
	SubmitTime  *int64             `json:"submit_time,omitempty" bson:"submit_time,omitempty"`
	Author      ReportAuthor       `json:"author" bson:"author"`
	Reviews     []ReviewInfo       `json:"reviews" bson:"reviews"`
	CreatedAt   int64              `json:"created_at" bson:"created_at"`
	UpdatedAt   int64              `json:"updated_at" bson:"updated_at"`
}

type ReportOverview struct {
	WeekSubmitted int             `json:"week_submitted"`
	WeekRequired  int             `json:"week_required"`
	StreakDays    int             `json:"streak_days"`
	Recent        []*ReportRecord `json:"recent"`
	LatestReview  *ReviewInfo     `json:"latest_review,omitempty"`
}

// ============ 员工档案（权限基础） ============

// Employee 是 OA 自己的员工档案，用 IM 的 userID 关联，不往 IM 核心表加字段。
// role: employee 普通员工 / manager 组长 / leader 领导
// 业务角色（role）决定"能看什么"，管理员标记（is_admin）决定"能不能维护人员"，
// 两者分开，领导可以兼任管理员，以后要独立 HR 账号也只是勾一个标记。
// disabled 为软停用：离职后保留档案与历史，但不再参与汇报链、看不到 OA 入口。
type Employee struct {
	CompanyID  string `json:"-" bson:"company_id"`
	UserID     string `json:"user_id" bson:"user_id"`
	RealName   string `json:"real_name" bson:"real_name"`
	Department string `json:"department" bson:"department"`
	DepartmentID string `json:"department_id,omitempty" bson:"department_id,omitempty"`
	Position   string `json:"position" bson:"position"`
	ManagerID  string `json:"manager_id" bson:"manager_id"`
	Role       string `json:"role" bson:"role"`
	IsAdmin    bool   `json:"is_admin" bson:"is_admin"`
	Disabled   bool   `json:"disabled" bson:"disabled"`

	// 以下为计算字段，不落库（bson:"-"）。
	// 前端据此决定要不要显示「团队出勤 / 报表」，避免先请求再被 403 打回来。
	SubordinateCount int  `json:"subordinate_count" bson:"-"`
	CanViewTeam      bool `json:"can_view_team" bson:"-"`
	CanViewAll       bool `json:"can_view_all" bson:"-"`
	CanReviewAttendance bool `json:"can_review_attendance" bson:"-"`
}

// EmployeeView 管理页列表用，附带 IM 侧的手机号与昵称，省一次关联查询。
type EmployeeView struct {
	Employee
	PhoneNumber string `json:"phone_number"`
	Nickname    string `json:"nickname"`
}

// IMUserOption 可添加的组织成员候选：来自 IM 已注册用户，排除已有 OA 档案的。
type IMUserOption struct {
	UserID      string `json:"user_id"`
	Nickname    string `json:"nickname"`
	PhoneNumber string `json:"phone_number"`
	HasProfile  bool   `json:"has_profile"`
}
