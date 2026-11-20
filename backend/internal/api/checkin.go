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

// deviceText 将浏览器可提供的平台和 UA 保存在原有设备字段中。
func deviceText(model, ua string) string {
	model = strings.TrimSpace(model)
	ua = strings.TrimSpace(ua)
	if len(ua) > 512 {
		ua = ua[:512]
	}
	if model == "" {
		return ua
	}
	if ua == "" {
		return model
	}
	return model + " | " + ua
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

	rule, err := s.effectiveAttendanceRule(ctx, auth.UserID(c))
	if err != nil {
		fail(c, "查询考勤规则失败")
		return
	}
	office := *rule.Office
	res := model.LocateResult{
		Lat:      lat,
		Lng:      lng,
		Address:  s.reverseGeocode(ctx, lat, lng),
		FenceSet: office.Configured,
		Office:   office,
		Source:   "gps",
		Accuracy: "precise",
	}
	if office.Configured {
		res.Distance = haversineMeters(lat, lng, office.Lat, office.Lng)
		res.InFence = res.Distance <= office.Radius
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

	list, err := s.loadVisibleCheckins(ctx, bson.M{
		"company_id": s.Cfg.CompanyID,
		"user_id":    uid,
		"date":       date,
	})
	if err != nil {
		fail(c, "查询失败")
		return
	}
	rule, err := s.attendanceRuleForDate(ctx, uid, date)
	if err != nil {
		fail(c, "查询考勤规则失败")
		return
	}
	resp := model.TodayCheckin{Date: date, CanCheckin: true, Rule: checkinRuleOf(rule), Office: *rule.Office}
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
	Type         string   `json:"type"`
	Photo        string   `json:"photo"`
	Lat          *float64 `json:"lat"`
	Lng          *float64 `json:"lng"`
	LocationName string   `json:"location_name"`
	// 来源由前端带回，但后端必须用 LocationToken 校验，不能只信这个字符串。
	LocationSource string `json:"location_source"`
	LocationToken  string `json:"location_token"`
	DeviceInfo     struct {
		Model string `json:"model"`
		UA    string `json:"ua"`
	} `json:"device_info"`
}

const maxCheckinPhotoBytes = 300 * 1024

func parseCheckinPhoto(photo string) (io.Reader, int64, string, string, string) {
	if strings.TrimSpace(photo) == "" {
		return nil, 0, "", "", ""
	}
	reader, size, mime, ext, valid := dataURLToReader(photo)
	if !valid {
		return nil, 0, "", "", "打卡照片格式无效，请重新拍照"
	}
	if size > maxCheckinPhotoBytes {
		return nil, 0, "", "", "打卡照片不能超过 300 KiB，请重新拍照"
	}
	switch mime {
	case "image/jpeg", "image/png", "image/webp":
		return reader, size, mime, ext, ""
	default:
		return nil, 0, "", "", "打卡照片格式无效，请重新拍照"
	}
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
	photo, photoSize, photoMIME, photoExt, photoError := parseCheckinPhoto(req.Photo)
	if photoError != "" {
		fail(c, photoError)
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
	rule, err := s.attendanceRuleForDate(ctx, uid, date)
	if err != nil {
		fail(c, "查询考勤规则失败")
		return
	}
	nowMin := minuteOfDay(now)
	if isWorkday(date, rule.Workdays) {
		if req.Type == "on" && nowMin < parseHM(rule.EarliestOn) {
			fail(c, "未到最早上班打卡时间")
			return
		}
		if req.Type == "on" && nowMin > parseHM(rule.WorkOnTime)+rule.LateGrace {
			status, statusText = "late", "迟到"
		} else if req.Type == "off" && nowMin < parseHM(rule.WorkOffTime) {
			status, statusText = "early", "早退"
		}
	}

	// 规则要求拍照就必须真带照片：前端已经没有「模拟照片」这个口子，
	// 后端也不再接受空照片，否则等于把「防代打」关掉。
	if rule.NeedPhoto && photo == nil {
		fail(c, "请先拍摄打卡照片")
		return
	}

	office := *rule.Office
	hasLocation := req.Lat != nil && req.Lng != nil
	if rule.NeedLocation && !hasLocation {
		fail(c, "未获取到定位，请允许浏览器使用位置后重试")
		return
	}
	// 定位来源不能只信前端字符串：只有后端签发过 token 的才算 IP 定位。
	// IP 定位精度是城市级，绝不参与 500 米围栏判定，否则会误判员工。
	locationSource, locationAccuracy := "gps", "precise"
	clientIP := requestIP(c)
	if req.LocationSource == "ip" {
		tokenIP, ok := s.verifyIPLocationToken(req.LocationToken, now)
		if !ok {
			fail(c, "IP 定位凭证无效或已过期，请重新定位")
			return
		}
		locationSource, locationAccuracy = "ip", "city"
		if clientIP == "" {
			clientIP = tokenIP
		}
	}

	if (req.Lat != nil || req.Lng != nil) && (!hasLocation || !validCoord(*req.Lat, *req.Lng)) {
		fail(c, "定位参数无效")
		return
	}
	if locationSource == "ip" && !hasLocation {
		fail(c, "IP 定位缺少坐标，请重新定位")
		return
	}
	distance, inFence := 0, false
	// IP 定位只有城市级精度，不能拿城市坐标判 500 米围栏。
	fenceSet := office.Configured && hasLocation && locationAccuracy == "precise"
	if fenceSet {
		distance = haversineMeters(*req.Lat, *req.Lng, office.Lat, office.Lng)
		inFence = distance <= office.Radius
		if !inFence && office.Strict {
			fail(c, fmt.Sprintf("当前位置距打卡点 %s，超出 %s 打卡范围", fmtDistance(distance), fmtDistance(office.Radius)))
			return
		}
	}

	userAgent := c.Request.UserAgent()
	if userAgent == "" {
		userAgent = req.DeviceInfo.UA
	}
	rec := model.CheckinRecord{
		ID:               fmt.Sprintf("ck_%s_%s_%s", uid, date, req.Type),
		CompanyID:        s.Cfg.CompanyID,
		UserID:           uid,
		Date:             date,
		Type:             req.Type,
		CheckinTime:      now.UnixMilli(),
		LocationName:     office.Name,
		Distance:         distance,
		InFence:          inFence,
		FenceSet:         fenceSet,
		Device:           deviceText(req.DeviceInfo.Model, userAgent),
		Status:           status,
		StatusText:       statusText,
		Source:           "normal",
		LocationSource:   locationSource,
		LocationAccuracy: locationAccuracy,
		ClientIP:         clientIP,
		CreatedAt:        now.UnixMilli(),
		RuleSnapshot:     &rule,
	}
	if hasLocation {
		rec.Lat, rec.Lng = *req.Lat, *req.Lng
		rec.Address = s.reverseGeocode(ctx, rec.Lat, rec.Lng)
	}

	// 照片必须存下来，"拍照打卡"才有防代打的意义。
	// 前端传来的是已画好水印的 base64 图片，这里落 MinIO 后只存 file_id。
	if photo != nil {
		if s.Files == nil {
			fail(c, "打卡照片服务未就绪，请联系管理员")
			return
		}
		name := fmt.Sprintf("打卡照片_%s_%s%s", date, req.Type, photoExt)
		meta, err := s.saveFile(ctx, uid, name, "checkin", photo, photoSize, photoMIME)
		if err != nil {
			fail(c, "打卡照片保存失败，请重试")
			return
		}
		rec.PhotoURL = "/oa/api/v1/files/" + meta.ID
		rec.PhotoFileID = meta.ID
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
	list, err := s.loadVisibleCheckins(ctx, filter)
	if err != nil {
		fail(c, "查询失败")
		return
	}
	if list == nil {
		list = []model.CheckinRecord{}
	}
	timeline, err := s.attendanceRuleTimeline(ctx)
	if err != nil {
		fail(c, "查询考勤规则失败")
		return
	}
	deptID := s.employeeDepartmentID(ctx, uid)
	leaveDays, err := s.loadApprovedLeaveDays(ctx, []string{uid}, month)
	if err != nil {
		fail(c, "查询请假记录失败")
		return
	}
	ok(c, gin.H{"total": len(list), "list": list, "month": month,
		"rule":                checkinRuleOf(timeline.forDay(deptID, todayStr(time.Now()))),
		"rules_by_date":       timeline.checkinCalendar(deptID, month),
		"approved_leave_days": leaveDays[uid],
	})
}
