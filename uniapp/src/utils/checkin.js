/**
 * 打卡 / 出勤相关的纯函数 —— 与 frontend/src/pages/checkin/utils.ts 一一对应。
 * 出勤页（下一批）也会复用这里的月历与状态映射。
 *
 * 时间一律按**北京时间**显示（见 utils/beijing.js），不受设备时区影响。
 */
import { bjHM, bjDateTime, bjShortDateTime } from "./beijing";

/** 打卡状态 → 颜色（PC 用 antd Tag 的色名，这里映射成实际色值） */
export const STATUS_COLOR = {
  normal: "var(--ok-text)", // green
  late: "#d97706", // orange
  early: "#d97706", // orange
  location_abnormal: "var(--danger)", // red
  makeup: "var(--primary)", // blue
};

export const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

/** 时间戳 → HH:mm（北京时间） */
export function fmtTime(ts) {
  if (!ts) return "--:--";
  return bjHM(ts);
}

/** 时间戳 → 完整的北京时间（列表/详情用） */
export function fmtDateTime(ts) {
  if (!ts) return "";
  return bjDateTime(ts);
}

/** 时间戳 → MM-DD HH:mm（紧凑列表用） */
export function fmtShortDateTime(ts) {
  if (!ts) return "";
  return bjShortDateTime(ts);
}

export function fmtDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const weeks = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${d.getMonth() + 1}月${d.getDate()}日 ${weeks[d.getDay()]}`;
}

/** 米 → 人类可读距离，和服务端同一套口径 */
export function fmtDistance(m) {
  const n = Number(m) || 0;
  return n < 1000 ? `${n} 米` : `${(n / 1000).toFixed(1)} 公里`;
}

/** Date → YYYY-MM-DD（本地时区，不能用 toISOString，会跨时区错一天） */
export function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 生成月历格子（周一为首列），首尾用 null 补齐整周 */
export function buildCells(month) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const offset = (first.getDay() + 6) % 7; // 周日=0 → 周一=0
  const total = new Date(y, m, 0).getDate();
  const cells = new Array(offset).fill(null);
  for (let i = 1; i <= total; i += 1) {
    cells.push(`${month}-${String(i).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function isWeekend(date) {
  const d = new Date(`${date}T00:00:00`);
  return d.getDay() === 0 || d.getDay() === 6;
}

/**
 * 服务端的状态码 → 日历用的状态。
 * 服务端判「今天还没下班只打了上班卡」为 in_progress（不算缺卡），
 * 这里必须保留这个区分，否则下午三点一整屏都在标红。
 */
export function serverStateToDayState(s) {
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

/** "09:05" → 当天的分钟数，用来判断「现在过没过下班点」 */
export function hmMinutes(hm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || "").trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 记录的地点：优先街道地址，其次打卡点名，最后退回坐标 */
export function placeText(r) {
  if (!r) return "";
  if (r.address) return r.address;
  if (r.location_name) return r.location_name;
  if (r.lat && r.lng) return `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`;
  return "";
}

export const STATE_TEXT = {
  done: "已打卡",
  partial: "缺一次卡",
  absent: "缺卡",
  leave: "已批准请假",
  in_progress: "上班中，未打下班卡",
  weekend: "周末休息",
  future: "还未到",
  idle: "无记录",
};

/**
 * 单日状态判定 —— 前端唯一一份实现，本人出勤、成员月历都用它。
 * 必须和服务端 dayStatusOf 口径一致，否则会出现「组长看到缺卡、
 * 员工自己看到正常」这种最伤信任的差异。
 *
 * 第 6 个参数 approvedLeave 与 PC 的 dayState.ts 同签名同名：
 * 已批准的请假优先于一切判定（含打卡记录），请假日不算缺卡。
 */
export function stateOfDay(pair, date, todayKey, now, rule, approvedLeave = false) {
  if (approvedLeave) return "leave";
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const onMin = hmMinutes((rule && rule.work_on_time) || "09:05");
  const offMin = hmMinutes((rule && rule.work_off_time) || "18:00");

  const hasOn = Boolean(pair && pair.on);
  const hasOff = Boolean(pair && pair.off);

  if (hasOn && hasOff) return "done";
  if (hasOn) {
    // 今天且还没到下班点：进行中，不算缺卡
    return date === todayKey && nowMin < offMin ? "in_progress" : "partial";
  }
  if (hasOff) return "partial";
  if (date > todayKey) return "future";
  if (date === todayKey && nowMin < onMin) return "future";
  const d = new Date(`${date}T00:00:00`);
  if (d.getDay() === 0 || d.getDay() === 6) return "weekend";
  return "absent";
}
