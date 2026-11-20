import http from "node:http";
import https from "node:https";

// 桌面端主进程没有浏览器 CORS 限制，可以直接问本机出口公网 IP 及城市级坐标。
// 这样打卡定位用的是「员工自己的网络」，后端不必猜机房出口，也不需要访问外部 IP 库。
const ENDPOINTS = [
  "http://ip-api.com/json/?fields=status,message,country,regionName,city,lat,lon,query",
  "https://ipapi.co/json/",
];

export interface IpLocation {
  ip: string;
  lat: number;
  lng: number;
  address: string;
}

function fetchJson(url: string, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https:") ? https : http;
    const req = mod.get(url, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 64 * 1024) req.destroy(new Error("response too large"));
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(raw) as Record<string, unknown>);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** 本机公网 IPv4 + 城市级坐标；拿不到返回 null，由后端继续兜底。 */
export async function getIpLocation(): Promise<IpLocation | null> {
  for (const endpoint of ENDPOINTS) {
    try {
      const body = await fetchJson(endpoint, 3000);
      if (body.status && body.status !== "success") continue;
      const ip = (body.query || body.ip) as unknown;
      const lat = Number(body.lat || body.latitude);
      const lng = Number(body.lon || body.longitude);
      if (
        typeof ip !== "string" ||
        !IPV4.test(ip) ||
        ip === "127.0.0.1" ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        (lat === 0 && lng === 0)
      ) {
        continue;
      }
      const address = [body.country, body.regionName || body.region, body.city]
        .filter((v) => typeof v === "string" && v.trim())
        .join("")
        .slice(0, 200);
      return { ip, lat, lng, address };
    } catch (_) {
      // 换下一个服务，不把网络错误抛给打卡页
    }
  }
  return null;
}
