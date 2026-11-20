package api

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"

	"github.com/xinbo/xinbo-oa/internal/auth"
	"github.com/xinbo/xinbo-oa/internal/model"
)

// 工作台概览：把首页需要的「今日打卡 + 今日日报 + 待办」一次算完。
// 待办数量必须由服务端按真实数据和角色算，前端只负责渲染，
// 否则会出现"显示 2 条审批，点进去一条都没有"的假数据问题。

type workbenchTodo struct {
	Key    string `json:"key"`
	Dot    string `json:"dot"`
	Text   string `json:"text"`
	Action string `json:"action"`
	Path   string `json:"path"`
}

type workbenchCheckin struct {
	HasOn     bool   `json:"has_on"`
	HasOff    bool   `json:"has_off"`
	OnTime    string `json:"on_time"`
	OffTime   string `json:"off_time"`
	OnStatus  string `json:"on_status"`
	OffStatus string `json:"off_status"`
	Location  string `json:"location"`
	BtnText   string `json:"btn_text"`
}

type workbenchReport struct {
	Submitted bool   `json:"submitted"`
	Status    string `json:"status"`
	Period    string `json:"period"`
}

func hhmm(ms int64) string {
	if ms <= 0 {
		return ""
	}
	return time.UnixMilli(ms).Format("15:04")
}

func isWeekday(t time.Time) bool {
	return t.Weekday() != time.Saturday && t.Weekday() != time.Sunday
}

// WorkbenchSummary 工作台首页数据
func (s *Server) WorkbenchSummary(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	uid := auth.UserID(c)
	now := time.Now()
	date := todayStr(now)

	// ---------- 今日打卡 ----------
	resp := workbenchCheckin{}
	cur, err := s.Store.Checkins().Find(ctx, bson.M{
		"company_id": s.Cfg.CompanyID,
		"user_id":    uid,
		"date":       date,
	})
	if err == nil {
		var list []model.CheckinRecord
		if e := cur.All(ctx, &list); e == nil {
			for i := range list {
				r := list[i]
				switch r.Type {
				case "on":
					resp.HasOn = true
					resp.OnTime = hhmm(r.CheckinTime)
					resp.OnStatus = r.StatusText
					if r.LocationName != "" {
						resp.Location = r.LocationName
					}
				case "off":
					resp.HasOff = true
					resp.OffTime = hhmm(r.CheckinTime)
					resp.OffStatus = r.StatusText
				}
			}
		}
	}
	switch {
	case !resp.HasOn:
		resp.BtnText = "拍照打卡上班"
	case !resp.HasOff:
		resp.BtnText = "拍照打卡下班"
	default:
		resp.BtnText = "今日打卡已完成"
	}

	// ---------- 今日日报 ----------
	rep := workbenchReport{Period: date}
	var today model.ReportRecord
	if e := s.Store.Reports().FindOne(ctx, bson.M{
		"company_id":     s.Cfg.CompanyID,
		"author.user_id": uid,
		"period":         date,
		"type":           "daily",
	}).Decode(&today); e == nil {
		rep.Status = today.Status
		rep.Submitted = today.Status != "" && today.Status != "draft"
	}

	// ---------- 待办 ----------
	me := s.getEmployee(ctx, uid)
	role := "employee"
	isAdmin := false
	disabled := false
	if me != nil {
		role = me.Role
		isAdmin = me.IsAdmin
		disabled = me.Disabled
	}

	todos := make([]workbenchTodo, 0, 4)
	// 离职（停用）账号不再推送待办，避免已离职的人还收到催办
	if !disabled {
		weekday := isWeekday(now)

		// 1. 今日日报未提交（只在工作日提醒，周末不催）
		if weekday && !rep.Submitted {
			todos = append(todos, workbenchTodo{
				Key: "report", Dot: "#E34D59", Text: "今天日报还没提交",
				Action: "去写", Path: "/report",
			})
		}

		// 2. 组长：待我点评的日报
		if role == "manager" || (isAdmin && role != "leader") {
			if n := s.pendingCount(ctx, s.subordinateIDs(ctx, uid), "submitted"); n > 0 {
				todos = append(todos, workbenchTodo{
					Key: "review", Dot: "#F0A020", Text: itoa(n) + " 条日报待你点评",
					Action: "去点评", Path: "/report-review",
				})
			}
		}

		// 3. 领导：组员已上报、待我审阅的日报
		if role == "leader" || isAdmin {
			if n := s.pendingCount(ctx, s.teamIDs(ctx, uid), "pending_leader"); n > 0 {
				todos = append(todos, workbenchTodo{
					Key: "review", Dot: "#E34D59", Text: itoa(n) + " 条日报待你审阅",
					Action: "去审阅", Path: "/report-review",
				})
			}
		}

		// 4. 请假/补卡待审批：按汇报链算（复用统一口径），组长/领导看到真实条数
		if s.canUseScope(ctx, uid, ScopeTeam) {
			ids := s.visibleUserIDs(ctx, uid, ScopeTeam)
			// 组长只看直属，领导看整条链——与审批接口的可见范围一致
			if role != "leader" && !isAdmin && len(ids) > 0 {
				direct := s.subordinateIDs(ctx, uid)
				ids = direct
			}
			if len(ids) > 0 {
				flt := bson.M{"company_id": s.Cfg.CompanyID, "status": "pending", "user_id": bson.M{"$in": ids}}
				lvN, e1 := s.Store.Leaves().CountDocuments(ctx, flt)
				mkN, e2 := s.Store.Makeups().CountDocuments(ctx, flt)
				if e1 == nil && e2 == nil && lvN+mkN > 0 {
					todos = append(todos, workbenchTodo{
						Key: "leave", Dot: "#F0A020",
						Text:   itoa(int(lvN+mkN)) + " 条请假/补卡待审批",
						Action: "去处理", Path: "/leave",
					})
				}
			}
		}

		// 5. 打卡提醒
		if !resp.HasOn && weekday {
			todos = append(todos, workbenchTodo{
				Key: "checkin", Dot: "#0089FF", Text: "今天还没打上班卡",
				Action: "去打卡", Path: "/checkin",
			})
		} else if resp.HasOn && !resp.HasOff && now.Hour() >= 18 {
			todos = append(todos, workbenchTodo{
				Key: "checkin", Dot: "#0089FF", Text: "还没打下班卡",
				Action: "去打卡", Path: "/checkin",
			})
		}

		// 6. 管理员：还没设置直属上级的成员（这类人的日报没人能审）
		if isAdmin {
			n, err := s.Store.Employees().CountDocuments(ctx, bson.M{
				"company_id": s.Cfg.CompanyID,
				"role":       bson.M{"$in": bson.A{"employee", "manager"}},
				"manager_id": "",
				"disabled":   bson.M{"$ne": true},
			})
			if err == nil && n > 0 {
				todos = append(todos, workbenchTodo{
					Key: "admin", Dot: "#F0A020", Text: itoa(int(n)) + " 名成员还没有直属上级",
					Action: "去设置", Path: "/oa-admin",
				})
			}
		}
	}

	ok(c, gin.H{
		"todos":   todos,
		"count":   len(todos),
		"checkin": resp,
		"report":  rep,
	})
}

// pendingCount 统计某个作者集合下指定状态的日报数量
func (s *Server) pendingCount(ctx context.Context, ids []string, status string) int {
	if len(ids) == 0 {
		return 0
	}
	n, err := s.Store.Reports().CountDocuments(ctx, bson.M{
		"company_id":     s.Cfg.CompanyID,
		"status":         status,
		"author.user_id": bson.M{"$in": ids},
	})
	if err != nil {
		return 0
	}
	return int(n)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [8]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
