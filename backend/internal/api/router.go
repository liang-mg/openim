package api

import (
	"github.com/gin-gonic/gin"

	"github.com/xinbo/xinbo-oa/internal/auth"
	"github.com/xinbo/xinbo-oa/internal/config"
	"github.com/xinbo/xinbo-oa/internal/filestore"
	"github.com/xinbo/xinbo-oa/internal/store"
)

type Server struct {
	Store *store.Store
	Cfg   *config.Config
	Files *filestore.Store
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
	g.Use(auth.Middleware(s.Cfg.Secret))
	{
		g.GET("/me", s.Me)
		g.GET("/workbench/summary", s.WorkbenchSummary)

		// 上传与取链接需要登录态
		g.POST("/files/upload", s.Upload)
		g.GET("/files/:id/link", s.FileLink)

		g.GET("/checkin/today", s.TodayCheckin)
		g.GET("/checkin/locate", s.LocateCheckin)
		g.POST("/checkin/submit", s.SubmitCheckin)
		g.GET("/checkin/list", s.CheckinList)

		// 团队视角：组长看下属、HR/管理员看全公司；范围与越权全在服务端判
		g.GET("/checkin/team", s.TeamCheckin)
		g.GET("/checkin/team/:user_id", s.TeamMemberCheckin)
		// 出勤报表（含 ?format=csv 直接下载）
		g.GET("/checkin/report", s.AttendanceReport)

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
	}
	return r
}
