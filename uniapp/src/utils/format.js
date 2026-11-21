/** 通用格式化工具，等价于 PC 端散落在各页面的小函数 */

const WEEKS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 11月20日 周四 */
export function dateText(date = new Date()) {
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKS[date.getDay()]}`;
}

/** 2026-11-20 */
export function ymd(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** 2026-11 */
export function ym(date = new Date()) {
  return ymd(date).slice(0, 7);
}

/** 13:05（秒级时间戳 / 毫秒级时间戳 / 字符串都兼容） */
export function hm(value) {
  if (!value) return "";
  let d;
  if (typeof value === "number") d = new Date(value < 1e12 ? value * 1000 : value);
  else d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 3 分钟前 / 2 小时前 / 11-18 */
export function fromNow(value) {
  if (!value) return "";
  const ts = typeof value === "number" ? (value < 1e12 ? value * 1000 : value) : new Date(value).getTime();
  const diff = Date.now() - ts;
  if (diff < 60 * 1000) return "刚刚";
  if (diff < 3600 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 24 * 3600 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}-${d.getDate()}`;
}

export function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
