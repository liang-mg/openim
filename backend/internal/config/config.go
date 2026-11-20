package config

import (
	"os"
	"strconv"
)

// Config 全部走环境变量，便于容器化；本地开发直接跑默认值。
type Config struct {
	Port      string
	MongoURI  string
	MongoDB   string
	Secret    string
	CompanyID string

	// 文件存储：直接复用 IM 已在跑的 MinIO，不另起一套存储。
	// 附件、打卡照片都进 oa 桶，key 按 company/年月 分目录，方便按租户备份清理。
	MinioEndpoint  string
	MinioAccessKey string
	MinioSecretKey string
	MinioBucket    string
	MinioUseSSL    bool
	FileMaxMB      int64

	// 打卡定位：打卡点不是代码里假设的，部署方填了就按它判范围，没填就只记录
	// 真实坐标、不判范围（也不显示任何虚构的公司名/地址）。
	// 坐标用 GCJ-02（腾讯/高德同一套），浏览器 GPS 是 WGS-84，国内直接相减会有
	// 50~500 米偏差，所以半径默认给 500 米，市区办公点足够覆盖这层误差。
	OfficeLat    float64
	OfficeLng    float64
	OfficeName   string
	OfficeAddr   string
	OfficeRadius int
	// StrictFence=true 时超出半径直接拒绝打卡；默认 false：照常打卡但标注「范围外」，
	// 免得外勤、居家办公的人打不上卡，也方便先在浏览器里试流程。
	StrictFence bool
	// 腾讯位置服务 key，仅用于把经纬度换成可读地址（逆地理编码）。
	// 不配也能用：前端只显示坐标和距办公点距离。key 只留在服务端，不出现在前端包里。
	MapKey string

	// 作息规则：上班时间之后打上班卡算迟到，下班时间之前打下班卡算早退。
	// 默认 09:05 / 18:00，与公司实际作息一致；换班次只改环境变量，不用改代码。
	WorkOnTime string
	WorkOffTime string
	// 迟到宽限分钟数：容忍电梯排队、系统时间误差，0 表示超过即算迟到。
	LateGraceMin int
	// 最早可打上班卡的钟点，避免凌晨误触把卡打掉（当天就算已打卡）。
	EarliestOn string

	// 补卡：只补过去 N 天，每月最多 M 次（0 表示不限）。
	MakeupMaxDays  int
	MakeupMaxMonth int
}

func Load() *Config {
	return &Config{
		Port:     env("OA_PORT", "10010"),
		MongoURI: env("OA_MONGO_URI", "mongodb://openIM:<CHANGE_ME>@127.0.0.1:27017/openim_v3?authSource=openim_v3"),
		MongoDB:  env("OA_MONGO_DB", "openim_v3"),
		// chatToken 由 chat 的 RPC 配置 chat-rpc-admin.yml 里的 secret 签发，
		// 不是 share.yml 的 openIM.secret。OA 必须与它一致才能校验通过。
		Secret:    env("OA_TOKEN_SECRET", env("OPENIM_SECRET", "<CHANGE_ME>")),
		CompanyID: env("OA_COMPANY_ID", "xinbo"),

		MinioEndpoint:  env("OA_MINIO_ENDPOINT", "minio:9000"),
		MinioAccessKey: env("OA_MINIO_ACCESS_KEY", "root"),
		MinioSecretKey: env("OA_MINIO_SECRET_KEY", "<CHANGE_ME>"),
		MinioBucket:    env("OA_MINIO_BUCKET", "xinbo-oa"),
		MinioUseSSL:    env("OA_MINIO_USE_SSL", "false") == "true",
		FileMaxMB:      envInt("OA_FILE_MAX_MB", 20),

		// 默认空：没有配置打卡点就不判范围，也不显示任何虚构的公司名/地址。
		// 部署时在 .env 里填 XINBO_OA_OFFICE_* 才会启用打卡范围判定。
		OfficeLat:    envFloat("OA_OFFICE_LAT", 0),
		OfficeLng:    envFloat("OA_OFFICE_LNG", 0),
		OfficeName:   env("OA_OFFICE_NAME", ""),
		OfficeAddr:   env("OA_OFFICE_ADDRESS", ""),
		OfficeRadius: int(envInt("OA_OFFICE_RADIUS", 500)),
		StrictFence:  env("OA_CHECKIN_STRICT_FENCE", "false") == "true",
		MapKey:       env("OA_MAP_KEY", ""),

		// 作息：默认 09:05 上班、18:00 下班（用户确认的公司作息）。
		WorkOnTime:   env("OA_WORK_ON_TIME", "09:05"),
		WorkOffTime:  env("OA_WORK_OFF_TIME", "18:00"),
		LateGraceMin: int(envInt("OA_WORK_LATE_GRACE_MIN", 0)),
		EarliestOn:   env("OA_WORK_EARLIEST_ON", "06:30"),

		// 补卡默认：只补过去 7 天，每月最多 3 次（排期里你拍板的默认值）
		MakeupMaxDays:  int(envInt("OA_MAKEUP_MAX_DAYS", 7)),
		MakeupMaxMonth: int(envInt("OA_MAKEUP_MAX_MONTH", 3)),
	}
}

// envFloat 解析小数环境变量（经纬度），失败回落默认值，避免手误把服务起不来。
func envFloat(key string, def float64) float64 {
	if v := os.Getenv(key); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil && f != 0 {
			return f
		}
	}
	return def
}

func envInt(key string, def int64) int64 {
	if v := os.Getenv(key); v != "" {
		var n int64
		for _, c := range v {
			if c < '0' || c > '9' {
				return def
			}
			n = n*10 + int64(c-'0')
		}
		if n > 0 {
			return n
		}
	}
	return def
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
