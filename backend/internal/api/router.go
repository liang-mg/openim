package api

import (
	"context"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/xinbo/xinbo-oa/internal/auth"
	"github.com/xinbo/xinbo-oa/internal/config"
	"github.com/xinbo/xinbo-oa/internal/filestore"
	"github.com/xinbo/xinbo-oa/internal/model"
	"github.com/xinbo/xinbo-oa/internal/store"
)

type Server struct {
	Store *store.Store
	Cfg   *config.Config
	Files *filestore.Store

	// 考勤规则缓存：规则读得非常频繁（每次打卡判定、每张报表），
	// 但改动极少，所以缓存一分钟，保存规则时主动失效。
	ruleMu    sync.RWMutex
	ruleCache *model.AttendanceRule
	ruleAt    time.Time
}

func NewServer(st *store.Store, cfg *config.Config, files *filestore.Store) *Server {
	return &Server{Store: st, Cfg: cfg, Files: files}
}

func (s *Server) Router() *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())

	// 健康检查不鉴权，方便容器 healthcheck
	r.GET("/oa/api/v1/healthz", func(c *gin.Context) {
		ok(c, gin.H{"status": "ok"})
	})

	// 文件下载不走鉴权中间件：<img src> 和 <a download> 带不了 header。
	// 改为在 Download 内部二选一校验：短签名，或 header token。
	r.GET("/oa/api/v1/files/:id", s.Download)

	g := r.Group("/oa/api/v1")
	// 停用账号即使还持有旧 chatToken 也不允许访问 OA 数据；
	// 档案不存在的人（纯 IM 用户）不拦，避免影响聊天功能。
	g.Use(auth.MiddlewareWithCheck(s.Cfg.Secret, func(ctx context.Context, uid string) bool {
		e := s.getEmployee(ctx, uid)
		return e != nil && e.Disabled
	}))
	{
		g.GET("/me", s.Me)
		g.GET("/organization/departments", s.VisibleDepartments)
		g.GET("/workbench/summary", s.WorkbenchSummary)

		// 上传与取链接需要登录态
		g.POST("/files/upload", s.Upload)
		g.GET("/files/:id/link", s.FileLink)

		g.GET("/checkin/today", s.TodayCheckin)
		g.GET("/checkin/locate", s.LocateCheckin)
		// 桌面端无 GPS，系统定位超时后用公网 IP 取城市级坐标兜底
		g.GET("/checkin/locate-by-ip", s.LocateByIP)
		g.POST("/checkin/submit", s.SubmitCheckin)
		g.GET("/checkin/list", s.CheckinList)

		// 团队视角：组长看下属、HR/管理员看全公司；范围与越权全在服务端判
		g.GET("/checkin/team", s.TeamCheckin)
		g.GET("/checkin/team/:user_id", s.TeamMemberCheckin)
		// 出勤报表（含 ?format=csv 直接下载）
		g.GET("/checkin/report", s.AttendanceReport)
		g.GET("/management/dashboard", s.ManagementDashboard)

		// 请假 / 补卡：申请即落表、审批改状态、通过后合并进出勤统计
		g.POST("/leave/submit", s.SubmitLeave)
		g.GET("/leave/list", s.LeaveList)
		g.POST("/leave/approve", s.LeaveApprove)
		g.POST("/leave/cancel", s.LeaveCancel)
		g.POST("/makeup/submit", s.SubmitMakeup)
		g.GET("/makeup/list", s.MakeupList)
		g.POST("/makeup/approve", s.MakeupApprove)
		g.POST("/makeup/cancel", s.MakeupCancel)
		g.GET("/attendance/pending", s.AttendancePending)

		// 考勤规则配置（读：所有登录用户；写：管理员，接口内部再校验一次）
		g.GET("/attendance/rule", s.GetRule)
		g.POST("/attendance/rule", s.SaveRule)

		// 考勤异常：扫描产出、列表查看、本人申诉、组长处理
		g.POST("/checkin/exception/scan", s.ScanExceptions)
		g.GET("/checkin/exception/list", s.ExceptionList)
		g.POST("/checkin/exception/handle", s.ExceptionHandle)
		g.POST("/checkin/exception/appeal", s.ExceptionAppeal)

		// 审批中心：四类待办聚合到一个入口（不落新表，避免与源表不一致）
		g.GET("/approvals/list", s.ApprovalList)
		g.GET("/report/submit-rate", s.SubmitRate)
		g.POST("/report/urge", s.UrgeReports)

		// 站内通知（IM 推送是同一条记录的附加送达方式）
		g.GET("/notifications/list", s.NotificationList)
		g.POST("/notifications/read", s.NotificationRead)
		g.GET("/announcements/:id", s.AnnouncementDetail)
		g.POST("/announcements/:id/read", s.ReadAnnouncement)

		g.GET("/report/overview", s.ReportOverview)
		g.POST("/report/submit", s.SubmitReport)
		g.POST("/report/withdraw", s.WithdrawReport)
		g.GET("/report/review-list", s.ReviewList)
		g.POST("/report/review", s.SubmitReview)
		g.POST("/report/escalate", s.EscalateReport)
		g.POST("/report/archive", s.ArchiveReport)
		g.GET("/report/all-for-review", s.AllForReview)

		// 员工与权限管理（仅管理员，接口内部再校验一次，不依赖前端隐藏入口）
		g.GET("/admin/employees", s.EmployeeList)
		g.GET("/admin/im-users", s.IMUserCandidates)
		g.POST("/admin/employee/save", s.SaveEmployee)
		g.POST("/admin/employee/disable", s.DisableEmployee)
		g.GET("/admin/departments", s.DepartmentList)
		g.GET("/admin/audit", s.AuditList)
		g.GET("/admin/announcements", s.PublishedAnnouncements)
		g.POST("/admin/announcements", s.PublishAnnouncement)
		g.GET("/admin/announcements/:id/receipts", s.AnnouncementReceipts)
		g.GET("/admin/contract", s.EmployeeContract)
		g.POST("/admin/contract/save", s.SaveEmployeeContract)
		g.POST("/admin/department/save", s.SaveDepartment)
		g.POST("/admin/department/migrate", s.MigrateDepartment)
	}
	return r
}
