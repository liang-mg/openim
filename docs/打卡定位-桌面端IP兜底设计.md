# 打卡定位：桌面端 IP 兜底设计

> 更新：2026-11-20 · 对应 `xinbo-oa` 与 `openim-electron-demo` 本地改动
> 读者：接手打卡模块、排查"桌面端定位不出来"的同事

---

## 1. 为什么要有兜底

手机浏览器有 GPS 芯片，配合基站/WiFi 很快能拿到坐标。桌面端（Windows/macOS）**没有 GPS 硬件**，Chromium 只能依赖系统位置服务 + WiFi 热点扫描；国内 Windows 机器上这项服务经常关闭或连不上定位服务器，页面表现就是 12 秒后报「定位超时，请到空旷处或稍后重试」。

这不是代码错误，是桌面端的硬件/网络限制。所以定位链路改成：

```
系统定位（精确） → 成功 → 正常打卡
        ↓ 超时 / 拒绝 / 失败
桌面端主进程查本机公网 IP + 城市坐标 → 后端校验并签发凭证 → 以城市级坐标打卡
        ↓ 仍然失败
明确提示"未定位"，不允许打卡（不编造坐标）
```

## 2. 一条关键原则：IP 定位不判 500 米围栏

IP 定位精度只有**城市级**（几公里到几十公里），拿它去和 500 米打卡半径比较必然误判员工。因此：

- `accuracy=city` 的记录，`distance=0`、`in_fence=false`，前端不显示「打卡范围内/范围外」；
- 即使部署方开了 `XINBO_OA_OFFICE_STRICT` 严格围栏，IP 来源也不会被拒绝；
- 后端返回和落库都带 `location_accuracy=city`，组长在出勤记录里能看到蓝色「IP 定位」标记，和 GPS 现场打卡区分开；
- 出勤率、迟到早退统计口径不变——IP 定位只影响「位置精度」，不影响「有没有来上班」。

## 3. 数据怎么流

### 桌面端（推荐路径）

1. 打卡页先调 `navigator.geolocation.getCurrentPosition`，超时 12 秒；
2. 失败后调 `window.electronAPI.getIpLocation()`：主进程用 Node HTTP 直接请求 `ip-api.com`（无浏览器 CORS 限制），拿到 `{ ip, lat, lng, address }`；
3. 前端把这份结果传给 `GET /checkin/locate-by-ip?ip=...&lat=...&lng=...&address=...`；
4. 后端**不查外部 IP 库**，只校验坐标格式，签发 15 分钟有效的 `location_token`，返回 `source=ip / accuracy=city`；
5. 提交打卡时带上坐标 + `location_source=ip` + `location_token`，后端校验凭证后落库。

这样桌面端打卡不依赖后端能否访问外网 IP 库——实测把查询放在后端容器里会因出口 IP 被免费接口限流而随机失败。

### 网页端（兜底路径）

网页端没有 Node 主进程，不传坐标，后端依次尝试：请求头里的客户端公网 IP → 服务器出口 IP → 腾讯位置服务（配了 `OA_MAP_KEY` 才用）→ `ip-api.com`。结果按 IP 缓存 30 分钟，规避免费接口限流。

## 4. 防伪造：来源不能靠前端自报

如果只信前端传的 `location_source=ip`，任何人都能声明 IP 定位来绕过严格围栏。所以：

- `/checkin/locate-by-ip` 用 OA secret 派生专用 HMAC 密钥，签发 `base64url("ip|过期时间").hex(HMAC)`；
- 提交时后端用同一密钥验签并检查过期，凭证无效直接拒绝打卡；
- 凭证绑定的是 IP，不绑定坐标——IP 定位本身就不精确，伪造坐标得不到额外权限（不参与围栏、不减少出勤要求）。

相关实现：`src/xinbo-oa/internal/api/ip_locate.go`。

## 5. 落库字段

`oa_checkin` 在原有字段上新增（老记录读不到就是空，不影响历史报表）：

| 字段 | 取值 | 含义 |
|---|---|---|
| `location_source` | `gps` / `ip` | 坐标来源，与既有的 `source`（normal/makeup，表示是否补卡）是两个正交维度 |
| `location_accuracy` | `precise` / `city` | 精度；`city` 不参与围栏判定 |
| `client_ip` | IPv4 字符串 | 服务端实际看到的公网 IP（桌面端为客户端自己上报的），供组长审计 |

前端 `CheckinRecord` / `LocateResult` 同步了这些字段；本人打卡页、出勤记录页都有「IP 定位」标记，共用 `ipLocationTag()` 一份实现。

## 6. 边界情况

| 情况 | 行为 |
|---|---|
| 系统定位成功 | 走精确路径，判 500 米围栏，行为与以前完全一样 |
| 系统定位超时/拒绝 | 自动走 IP 兜底，不需要用户点第二次 |
| IP 查询拿不到公网 IP（纯内网） | 明确报「未获取到公网 IP」，不允许打卡，不编坐标 |
| IP 库限流/超时 | 桌面端路径不受影响；网页端有 30 分钟缓存兜底 |
| 凭证过期（15 分钟） | 提示「IP 定位凭证无效或已过期，请重新定位」 |
| 配了打卡点 + 严格模式 | GPS 来源照常拦范围外；IP 来源不拦，但标记可见 |
| 没配打卡点 | 两种来源都只记录真实坐标，不判范围 |

## 7. 回归与验收

```bash
# IP 定位全链路（16 项）
node scripts/oa_checkin_ip_check.js

# 既有打卡链路（不能被破坏）
node scripts/oa_checkin_geo_check.js
node scripts/oa_e2e_check.js
```

`oa_checkin_ip_check.js` 会临时给测试账号「王强」写一条打卡记录，跑完自动清理，不留脏数据。脚本覆盖：客户端坐标采用、来源/精度标记、凭证签发、带凭证打卡、落库字段、无凭证和篡改凭证必须拒绝。

## 8. 部署注意

- 桌面端 IP 兜底**不需要额外配置**，`ip-api.com` 免费额度足够小团队使用；
- 如果部署方有腾讯位置服务 key，填 `XINBO_OA_MAP_KEY`，网页端会优先用它；
- 端口和地址配置仍见 `docs/桌面端部署与分发.md`；
- 发同事前记得把内置服务器地址从 `127.0.0.1` 改成可访问的 IP/域名。
