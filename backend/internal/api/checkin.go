package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"

	"github.com/xinbo/xinbo-oa/internal/auth"
	"github.com/xinbo/xinbo-oa/internal/model"
)

func todayStr(t time.Time) string {
	return fmt.Sprintf("%04d-%02d-%02d", t.Year(), int(t.Month()), t.Day())
}

// deviceText 只留有用的部分：UA 截断到 180 字符，避免把整串指纹塞进库里。
func deviceText(model, ua string) string {
	ua = strings.TrimSpace(ua)
	if len(ua) > 180 {
		ua = ua[:180]
	}
	if model == "" {
		return ua
	}
	if ua == "" {
		return model
	}
	return model + " | " + ua
}

// todayRule 当前生效的作息规则。时间来自「考勤规则配置」（库里一套 + 环境变量兜底），
// 打卡判定、团队表、报表、异常扫描共用这一份，避免"页面写 9:00、后端按 9:30 算"。
func (s *Server) todayRule() model.CheckinRule {
	r := s.currentRule()
	return model.CheckinRule{
		WorkOnTime:   r.WorkOnTime,
		WorkOffTime:  r.WorkOffTime,
		LateGrace:    r.LateGrace,
		EarliestOn:   r.EarliestOn,
		NeedPhoto:    r.NeedPhoto,
		NeedLocation: r.NeedLocation,
	}
}

// parseHM 把 "09:05" 解析成当天第几分钟（0~1439）。解析失败回落 0，
// 调用方要保证配置能解析，配置错了顶多判成"不迟到"，不会把打卡拦住。
func parseHM(v string) int {
	var h, m int
	if _, err := fmt.Sscanf(strings.TrimSpace(v), "%d:%d", &h, &m); err != nil {
		return 0
	}
	if h < 0 || h > 23 || m < 0 || m > 59 {
		return 0
	}
	return h*60 + m
}

func minuteOfDay(t time.Time) int { return t.Hour()*60 + t.Minute() }

// officeInfo 打卡点信息，全部来自配置。没配（经纬度为 0）时 Configured=false，
// 此时只记录真实坐标，不判范围，也不会编一个公司名出来。
func (s *Server) officeInfo() model.OfficeInfo {
	return model.OfficeInfo{
		Name:       s.Cfg.OfficeName,
		Address:    s.Cfg.OfficeAddr,
		Lat:        s.Cfg.OfficeLat,
		Lng:        s.Cfg.OfficeLng,
		Radius:     s.Cfg.OfficeRadius,
		Strict:     s.Cfg.StrictFence,
		Configured: s.Cfg.OfficeLat != 0 && s.Cfg.OfficeLng != 0,
	}
}

// haversineMeters 两点球面距离（米）。打卡判范围不需要投影精度，够用且无依赖。
func haversineMeters(lat1, lng1, lat2, lng2 float64) int {
	const r = 6371000.0
	rad := math.Pi / 180
	dLat := (lat2 - lat1) * rad
	dLng := (lng2 - lng1) * rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return int(2 * r * math.Asin(math.Sqrt(a)))
}

// fmtDistance 把米换成人类可读的距离，避免界面出现「13452 米」。
func fmtDistance(m int) string {
	if m < 1000 {
		return fmt.Sprintf("%d 米", m)
	}
	return fmt.Sprintf("%.1f 公里", float64(m)/1000)
}

// reverseGeocode 逆地理编码：坐标 → 可读地址。
// 只有配了 OA_MAP_KEY（腾讯位置服务）才会真正请求，没配就返回空，
// 前端退化成显示经纬度 + 距离，不编造地址。
func (s *Server) reverseGeocode(ctx context.Context, lat, lng float64) string {
	if s.Cfg.MapKey == "" {
		return ""
	}
	u := fmt.Sprintf(
		"https://apis.map.qq.com/ws/geocoder/v1/?location=%.6f,%.6f&key=%s&get_poi=0",
		lat, lng, url.QueryEscape(s.Cfg.MapKey),
	)
	reqCtx, cancel := context.WithTimeout(ctx, 2500*time.Millisecond)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, u, nil)
	if err != nil {
		return ""
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	var body struct {
		Status int `json:"status"`
		Result struct {
			Address string `json:"address"`
		} `json:"result"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&body); err != nil {
		return ""
	}
	if body.Status != 0 {
		return ""
	}
	return strings.TrimSpace(body.Result.Address)
}

// LocateCheckin 前端拿到 GPS 坐标后调这里：换地址、算距离、判是否在范围内。
// 判定放在服务端，前端改坐标也没用（最终提交时后端会再算一遍）。
func (s *Server) LocateCheckin(c *gin.Context) {
	lat, err1 := strconv.ParseFloat(c.Query("lat"), 64)
	lng, err2 := strconv.ParseFloat(c.Query("lng"), 64)
	if err1 != nil || err2 != nil || !validCoord(lat, lng) {
		fail(c, "定位参数无效")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	office := s.officeInfo()
	res := model.LocateResult{
		Lat:      lat,
		Lng:      lng,
		Address:  s.reverseGeocode(ctx, lat, lng),
		FenceSet: office.Configured,
		Office:   office,
	}
	if office.Configured {
		res.Distance = haversineMeters(lat, lng, s.Cfg.OfficeLat, s.Cfg.OfficeLng)
		res.InFence = res.Distance <= s.Cfg.OfficeRadius
	}
	ok(c, res)
}

func validCoord(lat, lng float64) bool {
	return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat == 0 && lng == 0)
}

// TodayCheckin 今日打卡状态
func (s *Server) TodayCheckin(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	uid := auth.UserID(c)
	now := time.Now()
	date := todayStr(now)

	cur, err := s.Store.Checkins().Find(ctx, bson.M{
		"company_id": s.Cfg.CompanyID,
		"user_id":    uid,
		"date":       date,
	})
	if err != nil {
		fail(c, "查询失败")
		return
	}
	var list []model.CheckinRecord
	if err = cur.All(ctx, &list); err != nil {
		fail(c, "查询失败")
		return
	}

	resp := model.TodayCheckin{Date: date, CanCheckin: true, Rule: s.todayRule(), Office: s.officeInfo()}
	for i := range list {
		r := list[i]
		if r.Type == "on" {
			resp.On = &r
		} else if r.Type == "off" {
			resp.Off = &r
		}
	}
	ok(c, resp)
}

type submitCheckinReq struct {
	Type         string  `json:"type"`
	Photo        string  `json:"photo"`
	Lat          float64 `json:"lat"`
	Lng          float64 `json:"lng"`
	LocationName string  `json:"location_name"`
	DeviceInfo   struct {
		Model string `json:"model"`
		UA    string `json:"ua"`
	} `json:"device_info"`
}

// SubmitCheckin 提交打卡：时间以服务端为准，判定正常/迟到/早退
func (s *Server) SubmitCheckin(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var req submitCheckinReq
	if err := c.ShouldBindJSON(&req); err != nil || (req.Type != "on" && req.Type != "off") {
		fail(c, "参数错误")
		return
	}

	uid := auth.UserID(c)
	now := time.Now()
	date := todayStr(now)

	// 唯一索引兜底：同日同类型只能打一次（防重复点击、防并发）
	count, err := s.Store.Checkins().CountDocuments(ctx, bson.M{
		"company_id": s.Cfg.CompanyID,
		"user_id":    uid,
		"date":       date,
		"type":       req.Type,
	})
	if err != nil {
		fail(c, "查询失败")
		return
	}
	if count > 0 {
		fail(c, "今日已打过该卡")
		return
	}

	// 迟到/早退按配置的作息判定（默认 09:05 / 18:00），
	// 用"当天第几分钟"比较，避免 hour/minute 分开写漏掉边界。
	status, statusText := "normal", "正常"
	rule := s.todayRule()
	nowMin := minuteOfDay(now)
	if req.Type == "on" && nowMin > parseHM(rule.WorkOnTime)+rule.LateGrace {
		status, statusText = "late", "迟到"
	} else if req.Type == "off" && nowMin < parseHM(rule.WorkOffTime) {
		status, statusText = "early", "早退"
	}

	// 规则要求拍照就必须真带照片：前端已经没有「模拟照片」这个口子，
	// 后端也不再接受空照片，否则等于把「防代打」关掉。
	if s.todayRule().NeedPhoto && strings.TrimSpace(req.Photo) == "" {
		fail(c, "请先拍摄打卡照片")
		return
	}

	// 定位：服务端重算距离，前端传什么都得先过这里。
	// 没坐标就是没定位，不允许「静默跳过定位」打出卡来；配了打卡点才判范围。
	office := s.officeInfo()
	if !validCoord(req.Lat, req.Lng) {
		fail(c, "未获取到定位，请允许浏览器使用位置后重试")
		return
	}
	distance, inFence := 0, false
	if office.Configured {
		distance = haversineMeters(req.Lat, req.Lng, s.Cfg.OfficeLat, s.Cfg.OfficeLng)
		inFence = distance <= s.Cfg.OfficeRadius
		if !inFence && s.Cfg.StrictFence {
			fail(c, fmt.Sprintf("当前位置距打卡点 %s，超出 %s 打卡范围", fmtDistance(distance), fmtDistance(s.Cfg.OfficeRadius)))
			return
		}
	}
	address := s.reverseGeocode(ctx, req.Lat, req.Lng)

	rec := model.CheckinRecord{
		ID:           fmt.Sprintf("ck_%s_%s_%s", uid, date, req.Type),
		CompanyID:    s.Cfg.CompanyID,
		UserID:       uid,
		Date:         date,
		Type:         req.Type,
		CheckinTime:  now.UnixMilli(),
		LocationName: office.Name,
		Address:      address,
		Lat:          req.Lat,
		Lng:          req.Lng,
		Distance:     distance,
		InFence:      inFence,
		FenceSet:     office.Configured,
		Device:       deviceText(req.DeviceInfo.Model, req.DeviceInfo.UA),
		Status:       status,
		StatusText:   statusText,
		CreatedAt:    now.UnixMilli(),
	}

	// 照片必须存下来，"拍照打卡"才有防代打的意义。
	// 前端传来的是已画好水印的 base64 图片，这里落 MinIO 后只存 file_id。
	if req.Photo != "" && s.Files != nil {
		if r, size, mime, ext, isData := dataURLToReader(req.Photo); isData {
			if size > 4*1024*1024 {
				fail(c, "打卡照片过大，请重新拍照")
				return
			}
			name := fmt.Sprintf("打卡照片_%s_%s%s", date, req.Type, ext)
			if meta, e := s.saveFile(ctx, uid, name, "checkin", r, size, mime); e == nil {
				rec.PhotoURL = "/oa/api/v1/files/" + meta.ID
				rec.PhotoFileID = meta.ID
			} else {
				// 照片存不上就拒绝打卡：允许无照片打卡等于把"防代打"关掉
				fail(c, "打卡照片保存失败，请重试")
				return
			}
		} else {
			// 已经是上传后的地址，直接沿用
			rec.PhotoURL = req.Photo
		}
	}
	if _, err = s.Store.Checkins().InsertOne(ctx, rec); err != nil {
		if mongo.IsDuplicateKeyError(err) {
			fail(c, "今日已打过该卡")
			return
		}
		fail(c, "打卡失败")
		return
	}
	ok(c, rec)
}

// monthRange 把一个 "2026-11" 换成左闭右开的日期区间，
// 这样索引的 date 段能真正走到区间扫描；用 ^2026-11 正则只能扫完再过滤。
func monthRange(month string) (string, string, bool) {
	t, err := time.Parse("2006-01", month)
	if err != nil {
		return "", "", false
	}
	return t.Format("2006-01-02"), t.AddDate(0, 1, 0).Format("2006-01-02"), true
}

// CheckinList 打卡历史（自己的）
func (s *Server) CheckinList(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	month := c.Query("month")
	start, end, valid := monthRange(month)
	if !valid {
		month = todayStr(time.Now())[:7]
		start, end, _ = monthRange(month)
	}
	uid := auth.UserID(c)

	filter := bson.M{
		"company_id": s.Cfg.CompanyID,
		"user_id":    uid,
		"date":       bson.M{"$gte": start, "$lt": end},
	}
	cur, err := s.Store.Checkins().Find(ctx, filter)
	if err != nil {
		fail(c, "查询失败")
		return
	}
	var list []model.CheckinRecord
	if err = cur.All(ctx, &list); err != nil {
		fail(c, "查询失败")
		return
	}
	if list == nil {
		list = []model.CheckinRecord{}
	}
	ok(c, gin.H{"total": len(list), "list": list, "month": month, "rule": s.todayRule()})
}
