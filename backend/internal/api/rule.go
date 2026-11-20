package api

import (
	"context"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/xinbo/xinbo-oa/internal/auth"
	"github.com/xinbo/xinbo-oa/internal/model"
)

// 考勤规则配置（批次 3.1 / F8）
//
// 设计取舍：
//   - 一家公司一套规则，不做部门级/个人级——真有需要再加，避免一上来四层优先级没人能解释清楚。
//   - 规则只在服务端生效。前端拿到的 rule 只用于"显示几点上班"，改前端时间不影响判定。
//   - **规则变更不回溯**：历史打卡记录的 status（迟到/早退）在写入那天就固化了，
//     所以改规则之后看旧报表数字不会变。这是刻意的——报表是要给人签字的东西。

const ruleCacheTTL = time.Minute

// defaultRule 环境变量里的默认值，作为"库里还没配过"时的兜底。
func (s *Server) defaultRule() model.AttendanceRule {
	return model.AttendanceRule{
		CompanyID:      s.Cfg.CompanyID,
		WorkOnTime:     s.Cfg.WorkOnTime,
		WorkOffTime:    s.Cfg.WorkOffTime,
		LateGrace:      s.Cfg.LateGraceMin,
		EarliestOn:     s.Cfg.EarliestOn,
		NeedPhoto:      true,
		NeedLocation:   true,
		MakeupMaxDays:  s.Cfg.MakeupMaxDays,
		MakeupMaxMonth: s.Cfg.MakeupMaxMonth,
		Source:         "env",
	}
}

// currentRule 读当前生效规则：先看缓存（60 秒），再看库，最后回落环境变量。
// 打卡、团队表、报表、异常扫描全部走这一个函数——口径只有一份。
func (s *Server) currentRule() model.AttendanceRule {
	s.ruleMu.RLock()
	cached, at := s.ruleCache, s.ruleAt
	s.ruleMu.RUnlock()
	if cached != nil && time.Since(at) < ruleCacheTTL {
		return *cached
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var r model.AttendanceRule
	err := s.Store.Rules().FindOne(ctx, bson.M{"company_id": s.Cfg.CompanyID}).Decode(&r)
	if err != nil {
		// 没配过 / 库暂时不可用：用环境变量兜底，保证服务不会因为缺规则而起不来
		r = s.defaultRule()
	} else {
		r.Source = "db"
	}

	s.ruleMu.Lock()
	s.ruleCache = &r
	s.ruleAt = time.Now()
	s.ruleMu.Unlock()
	return r
}

// invalidateRuleCache 保存规则后立即失效，管理员改完不用等一分钟。
func (s *Server) invalidateRuleCache() {
	s.ruleMu.Lock()
	s.ruleCache = nil
	s.ruleAt = time.Time{}
	s.ruleMu.Unlock()
}

// GetRule 读规则：所有登录用户都能读（页面要显示「9:05 上班」），写只能管理员。
func (s *Server) GetRule(c *gin.Context) {
	ok(c, s.currentRule())
}

// SaveRule 保存规则（仅管理员）
func (s *Server) SaveRule(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	uid := auth.UserID(c)
	if !s.isAdmin(ctx, uid) {
		failCode(c, 403, "只有管理员可以修改考勤规则")
		return
	}

	var req model.AttendanceRule
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, "参数错误")
		return
	}
	req.WorkOnTime = strings.TrimSpace(req.WorkOnTime)
	req.WorkOffTime = strings.TrimSpace(req.WorkOffTime)
	req.EarliestOn = strings.TrimSpace(req.EarliestOn)
	if req.EarliestOn == "" {
		req.EarliestOn = "06:30"
	}

	// 边界校验：时间必须是合法 HH:MM，且上班早于下班，否则一整天都会被判迟到/早退
	if !validHM(req.WorkOnTime) || !validHM(req.WorkOffTime) {
		fail(c, "上下班时间格式不正确（HH:MM）")
		return
	}
	if parseHM(req.WorkOnTime) >= parseHM(req.WorkOffTime) {
		fail(c, "下班时间必须晚于上班时间")
		return
	}
	if req.LateGrace < 0 || req.LateGrace > 120 {
		fail(c, "迟到宽限应在 0~120 分钟之间")
		return
	}
	if req.MakeupMaxDays < 0 || req.MakeupMaxDays > 90 {
		fail(c, "补卡可补天数应在 0~90 天之间")
		return
	}
	if req.MakeupMaxMonth < 0 || req.MakeupMaxMonth > 99 {
		fail(c, "每月补卡上限应在 0~99 次之间")
		return
	}

	req.CompanyID = s.Cfg.CompanyID
	req.UpdatedBy = uid
	req.UpdatedAt = time.Now().UnixMilli()

	if _, err := s.Store.Rules().UpdateOne(ctx,
		bson.M{"company_id": s.Cfg.CompanyID},
		bson.M{"$set": req},
		options.Update().SetUpsert(true),
	); err != nil {
		fail(c, "保存失败")
		return
	}
	s.invalidateRuleCache()
	req.Source = "db"
	ok(c, req)
}

// validHM 严格校验 HH:MM，避免 "9:5"、"25:00" 这种能过 Sscanf 但没法用的值。
func validHM(v string) bool {
	if len(v) != 5 || v[2] != ':' {
		return false
	}
	for i, ch := range v {
		if i == 2 {
			continue
		}
		if ch < '0' || ch > '9' {
			return false
		}
	}
	h := int(v[0]-'0')*10 + int(v[1]-'0')
	m := int(v[3]-'0')*10 + int(v[4]-'0')
	return h >= 0 && h <= 23 && m >= 0 && m <= 59
}
