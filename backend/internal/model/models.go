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
	Source    string `json:"source" bson:"source"`
	MakeupID  string `json:"makeup_id,omitempty" bson:"makeup_id,omitempty"`
	CreatedAt int64  `json:"created_at" bson:"created_at"`
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
}

// OfficeInfo 打卡点，下发给前端用于展示「距离多少米」；
// 坐标只用于判定，不做地图渲染。Configured=false 表示还没有配打卡点。
type OfficeInfo struct {
	Name       string  `json:"name"`
	Address    string  `json:"address"`
	Lat        float64 `json:"lat"`
	Lng        float64 `json:"lng"`
	Radius     int     `json:"radius"`
	Strict     bool    `json:"strict"`
	Configured bool    `json:"configured"`
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

// LeaveRequest 请假/出差申请：不可变记录，只改 status 不改内容。
// 批准不写 oa_checkin（请假日不是"打了卡"），只影响考勤统计口径。
type LeaveRequest struct {
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
