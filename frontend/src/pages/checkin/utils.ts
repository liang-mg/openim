import type { CheckinRecord } from "@/api/oaApi";

/** 打卡状态 → antd Tag 颜色 */
export const statusColor: Record<string, string> = {
  normal: "green",
  late: "orange",
  early: "orange",
  location_abnormal: "red",
  makeup: "blue",
};

export const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

export function fmtTime(ts?: number) {
  if (!ts) return "--:--";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function fmtDate(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  const weeks = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${d.getMonth() + 1}月${d.getDate()}日 ${weeks[d.getDay()]}`;
}

/** 米 → 人类可读距离，和服务端同一套口径 */
export function fmtDistance(m: number) {
  return m < 1000 ? `${m} 米` : `${(m / 1000).toFixed(1)} 公里`;
}

/** Date → YYYY-MM-DD（本地时区，不能用 toISOString，会跨时区错一天） */
export function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 生成月历格子（周一为首列），首尾用 null 补齐整周 */
export function buildCells(month: string): (string | null)[] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const offset = (first.getDay() + 6) % 7; // 周日=0 → 周一=0
  const total = new Date(y, m, 0).getDate();
  const cells: (string | null)[] = new Array(offset).fill(null);
  for (let i = 1; i <= total; i += 1) {
    cells.push(`${month}-${String(i).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function isWeekend(date: string) {
  const d = new Date(`${date}T00:00:00`);
  return d.getDay() === 0 || d.getDay() === 6;
}

export type DayState =
  | "done"
  | "partial"
  | "absent"
  | "leave"
  | "in_progress"
  | "weekend"
  | "future"
  | "idle";

/**
 * 服务端的状态码 → 日历用的状态。
 * 服务端判"今天还没下班只打了上班卡"为 in_progress（不算缺卡），
 * 这里必须保留这个区分，否则下午三点一整屏都在标红。
 */
export function serverStateToDayState(s: string): DayState {
  switch (s) {
    case "done":
      return "done";
    case "partial":
      return "partial";
    case "absent":
      return "absent";
    case "leave":
      return "leave";
    case "in_progress":
      return "in_progress";
    case "rest":
      return "weekend";
    default:
      return "future";
  }
}

/** "09:05" → 当天的分钟数，用来判断"现在过没过下班点" */
export function hmMinutes(hm?: string) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hm || "").trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 记录的地点：优先街道地址，其次打卡点名，最后退回坐标；都没有就不显示 */
export function placeText(r?: CheckinRecord | null) {
  if (!r) return "";
  if (r.address) return r.address;
  if (r.location_name) return r.location_name;
  if (r.lat && r.lng) return `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`;
  return "";
}

/**
 * 定位来源文案，本人/组长/HR 各页面共用同一套口径。
 * 只对 IP 兜底做标记——它只有城市级精度，不能和 GPS 现场打卡混为一谈。
 */
export function ipLocationTag(r?: CheckinRecord | null) {
  return r?.location_source === "ip" ? "IP 定位" : "";
}
