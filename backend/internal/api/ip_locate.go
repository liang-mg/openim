package api

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/xinbo/xinbo-oa/internal/model"
)

// IP 定位兜底：桌面端没有 GPS 芯片，Chromium 靠系统位置服务 + WiFi 扫描，
// 在国内 Windows 机器上基本都会超时。这里用客户端公网 IP 换一个城市级坐标，
// 精度只有城市级，绝不能拿去判 500 米打卡范围。

const (
	ipLocateTimeout  = 3 * time.Second
	exitIPCacheTTL   = 10 * time.Minute
	ipTokenTTL       = 15 * time.Minute
	ipTokenSep       = "|"
	ipTokenBodyParts = 2
)

var (
	exitIPMu    sync.Mutex
	exitIPValue string
	exitIPAt    time.Time

	// IP 归属变化很慢，缓存 30 分钟。免费 IP 库有每分钟请求上限，
	// 不缓存的话多人同时打卡很容易触发限流导致定位失败。
	geoCacheMu sync.Mutex
	geoCache   = map[string]struct {
		geo ipGeo
		at  time.Time
	}{}
	geoCacheTTL = 30 * time.Minute
)

// requestIP 取"看起来像公网"的客户端 IP。
// X-Forwarded-For 可被伪造，但这里只用它决定定位到哪个城市，
// 最终打卡记录里的 ClientIP 也原样落库供审计，不会赋予额外权限。
func requestIP(c *gin.Context) string {
	for _, raw := range strings.Split(c.GetHeader("X-Forwarded-For"), ",") {
		ip := strings.TrimSpace(raw)
		if ip != "" && !isPrivateIP(ip) {
			return ip
		}
	}
	if ip := strings.TrimSpace(c.GetHeader("X-Real-IP")); ip != "" && !isPrivateIP(ip) {
		return ip
	}
	ip := c.ClientIP()
	if ip != "" && !isPrivateIP(ip) {
		return ip
	}
	return ""
}

// isPrivateIP 环回 / 私网 / 链路本地 / 保留段都算"不能用于公网定位"。
func isPrivateIP(s string) bool {
	ip := net.ParseIP(strings.TrimSpace(s))
	if ip == nil {
		return true
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return true
	}
	// Docker/K8s 常见的 100.64/10 CGNAT 段
	if ip4 := ip.To4(); ip4 != nil {
		if ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127 {
			return true
		}
	}
	return false
}

// publicExitIP 本机/内网访问时没有公网客户端 IP，退回服务器出口 IP。
// 公司固定出口场景下这反而更贴近真实办公地点。结果缓存 10 分钟，
// 避免每次打卡都去打外部服务。
func publicExitIP(ctx context.Context) string {
	exitIPMu.Lock()
	if exitIPValue != "" && time.Since(exitIPAt) < exitIPCacheTTL {
		v := exitIPValue
		exitIPMu.Unlock()
		return v
	}
	exitIPMu.Unlock()

	// ip-api.com 在国内可达（ipify/ipinfo 常超时），放第一位；
	// 它的公网 IP 字段叫 query，其他服务叫 ip，这里一起兼容。
	for _, endpoint := range []string{
		"http://ip-api.com/json/?fields=status,query",
		"https://api.ipify.org?format=json",
		"https://ipinfo.io/json",
	} {
		reqCtx, cancel := context.WithTimeout(ctx, ipLocateTimeout)
		req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, endpoint, nil)
		if err != nil {
			cancel()
			continue
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			cancel()
			continue
		}
		var body struct {
			IP     string `json:"ip"`
			Query  string `json:"query"`
			Status string `json:"status"`
		}
		err = json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&body)
		resp.Body.Close()
		cancel()
		ip := body.IP
		if ip == "" {
			ip = body.Query
		}
		if err != nil || (body.Status != "" && body.Status != "success") || isPrivateIP(ip) {
			continue
		}
		exitIPMu.Lock()
		exitIPValue, exitIPAt = ip, time.Now()
		exitIPMu.Unlock()
		return ip
	}
	return ""
}

// ipGeo 是两种 IP 库共用的返回结构。
type ipGeo struct {
	Lat     float64
	Lng     float64
	Address string
}

// lookupIPGeo 优先用已配置的腾讯位置服务（和逆地理编码共用一个 key），
// 没配 key 就用 ip-api.com 的免费接口；查不到就返回 error，绝不编造坐标。
func (s *Server) lookupIPGeo(ctx context.Context, ip string) (ipGeo, error) {
	geoCacheMu.Lock()
	if hit, ok := geoCache[ip]; ok && time.Since(hit.at) < geoCacheTTL {
		g := hit.geo
		geoCacheMu.Unlock()
		return g, nil
	}
	geoCacheMu.Unlock()

	if s.Cfg.MapKey != "" {
		u := fmt.Sprintf(
			"https://apis.map.qq.com/ws/location/v1/ip?ip=%s&key=%s",
			url.QueryEscape(ip), url.QueryEscape(s.Cfg.MapKey),
		)
		if g, ok := fetchIPGeo(ctx, u, "tencent"); ok {
			cacheIPGeo(ip, g)
			return g, nil
		}
	}
	u := fmt.Sprintf(
		"http://ip-api.com/json/%s?lang=zh-CN&fields=status,message,country,regionName,city,lat,lon,query",
		url.PathEscape(ip),
	)
	if g, ok := fetchIPGeo(ctx, u, "ip-api"); ok {
		cacheIPGeo(ip, g)
		return g, nil
	}
	return ipGeo{}, fmt.Errorf("IP 归属查询失败")
}

func trimText(s string, max int) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) > max {
		return string(r[:max])
	}
	return string(r)
}

func cacheIPGeo(ip string, g ipGeo) {
	geoCacheMu.Lock()
	geoCache[ip] = struct {
		geo ipGeo
		at  time.Time
	}{geo: g, at: time.Now()}
	geoCacheMu.Unlock()
}

func fetchIPGeo(ctx context.Context, endpoint, provider string) (ipGeo, bool) {
	reqCtx, cancel := context.WithTimeout(ctx, ipLocateTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return ipGeo{}, false
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return ipGeo{}, false
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if err != nil {
		return ipGeo{}, false
	}

	var g ipGeo
	switch provider {
	case "tencent":
		var body struct {
			Status int `json:"status"`
			Result struct {
				Location struct {
					Lat float64 `json:"lat"`
					Lng float64 `json:"lng"`
				} `json:"location"`
				AdInfo struct {
					Province string `json:"province"`
					City     string `json:"city"`
					District string `json:"district"`
				} `json:"ad_info"`
			} `json:"result"`
		}
		if json.Unmarshal(raw, &body) != nil || body.Status != 0 {
			return ipGeo{}, false
		}
		g.Lat, g.Lng = body.Result.Location.Lat, body.Result.Location.Lng
		g.Address = strings.TrimSpace(body.Result.AdInfo.Province + body.Result.AdInfo.City + body.Result.AdInfo.District)
	case "ip-api":
		var body struct {
			Status     string  `json:"status"`
			Country    string  `json:"country"`
			RegionName string  `json:"regionName"`
			City       string  `json:"city"`
			Lat        float64 `json:"lat"`
			Lon        float64 `json:"lon"`
		}
		if json.Unmarshal(raw, &body) != nil || body.Status != "success" {
			return ipGeo{}, false
		}
		g.Lat, g.Lng = body.Lat, body.Lon
		g.Address = strings.TrimSpace(body.Country + body.RegionName + body.City)
	}
	if !validCoord(g.Lat, g.Lng) {
		return ipGeo{}, false
	}
	return g, true
}

// ipTokenKey 用 OA secret 派生专用密钥，避免和其他签名串互相撞车。
func (s *Server) ipTokenKey() []byte {
	mac := hmac.New(sha256.New, []byte(s.Cfg.Secret))
	mac.Write([]byte("oa-checkin-ip-location"))
	return mac.Sum(nil)
}

// issueIPLocationToken 给 IP 定位结果签发 15 分钟有效的凭证。
// 格式 base64url("ip|过期Unix秒") + "." + hex(HMAC-SHA256)。
func (s *Server) issueIPLocationToken(ip string, now time.Time) string {
	payload := ip + ipTokenSep + strconv.FormatInt(now.Add(ipTokenTTL).Unix(), 10)
	sig := hmac.New(sha256.New, s.ipTokenKey())
	sig.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + hex.EncodeToString(sig.Sum(nil))
}

// verifyIPLocationToken 校验凭证有效且未过期，返回它绑定的 IP。
func (s *Server) verifyIPLocationToken(token string, now time.Time) (string, bool) {
	if token == "" {
		return "", false
	}
	parts := strings.Split(token, ".")
	if len(parts) != ipTokenBodyParts {
		return "", false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", false
	}
	fields := strings.Split(string(raw), ipTokenSep)
	if len(fields) != ipTokenBodyParts {
		return "", false
	}
	exp, err := strconv.ParseInt(fields[1], 10, 64)
	if err != nil || now.Unix() > exp {
		return "", false
	}
	sig := hmac.New(sha256.New, s.ipTokenKey())
	sig.Write(raw)
	if !hmac.Equal([]byte(parts[1]), []byte(hex.EncodeToString(sig.Sum(nil)))) {
		return "", false
	}
	ip := fields[0]
	if net.ParseIP(ip) == nil || isPrivateIP(ip) {
		return "", false
	}
	return ip, true
}

// LocateByIP GPS 失败后的兜底接口。返回结构与 /checkin/locate 一致，
// 只是 source=ip、accuracy=city，并且不计算围栏距离。
func (s *Server) LocateByIP(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
	defer cancel()

	// 桌面端主进程可以直接取到本机公网 IP 并传上来，比服务端猜出口 IP 准得多；
	// 网页端没有这个能力，才退回请求头/服务器出口。传上来的 IP 只用于查城市，
	// 不赋予任何额外权限，且后端会签发 token 绑定它。
	ip := strings.TrimSpace(c.Query("ip"))
	if isPrivateIP(ip) {
		ip = requestIP(c)
	}
	if ip == "" {
		ip = publicExitIP(ctx)
	}
	if ip == "" || isPrivateIP(ip) {
		fail(c, "未获取到公网 IP，无法进行 IP 定位")
		return
	}
	var geo ipGeo
	// 桌面端主进程已经查好城市坐标，后端只校验格式并签发凭证。
	// 这样桌面端打卡不受外部 IP 库限流影响；网页端没这个能力才走后端查询。
	lat, e1 := strconv.ParseFloat(c.Query("lat"), 64)
	lng, e2 := strconv.ParseFloat(c.Query("lng"), 64)
	if e1 == nil && e2 == nil && validCoord(lat, lng) {
		geo = ipGeo{Lat: lat, Lng: lng, Address: trimText(c.Query("address"), 200)}
	} else {
		var err error
		geo, err = s.lookupIPGeo(ctx, ip)
		if err != nil {
			fail(c, "IP 定位失败，请稍后重试")
			return
		}
	}
	ok(c, model.LocateResult{
		Lat:      geo.Lat,
		Lng:      geo.Lng,
		Address:  geo.Address,
		Office:   s.officeInfo(),
		Source:   "ip",
		Accuracy: "city",
		IP:       ip,
		Token:    s.issueIPLocationToken(ip, time.Now()),
	})
}
