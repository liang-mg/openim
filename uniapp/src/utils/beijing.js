/**
 * 北京时间（UTC+8）工具。
 *
 * 为什么不用设备本地时间：手机上很可能不是东八区（出差、模拟器、系统时区被改），
 * 打卡、报表、审批这些时间必须是**北京时间**，否则会出现"明明 9 点打卡显示 1 点"。
 *
 * 做法：把时间戳加 8 小时，然后用 getUTC* 系列取值 —— 得到的正好是东八区的墙钟时间。
 * 不用 toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })：App 端 WebView 的
 * Intl 支持不全，且在低端机上比纯算术慢得多。
 */
const OFFSET = 8 * 60 * 60 * 1000;

const pad = (n) => String(n).padStart(2, "0");

/** 时间戳 → 东八区 Date（请配合 getUTC* 使用） */
export function bjDate(ts = Date.now()) {
  return new Date(Number(ts) + OFFSET);
}

/** 东八区"现在" */
export function bjNow() {
  return bjDate(Date.now());
}

/** HH:mm */
export function bjHM(ts) {
  const d = bjDate(ts);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** HH:mm:ss */
export function bjHMS(ts) {
  const d = bjDate(ts);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** YYYY-MM-DD */
export function bjYmd(ts) {
  const d = bjDate(ts);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** YYYY-MM-DD HH:mm */
export function bjDateTime(ts) {
  return `${bjYmd(ts)} ${bjHM(ts)}`;
}

/** MM-DD HH:mm（列表用） */
export function bjShortDateTime(ts) {
  const d = bjDate(ts);
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

const WEEKS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** M月D日 周X */
export function bjDateLabel(ts) {
  const d = bjDate(ts);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${WEEKS[d.getUTCDay()]}`;
}

export default { bjDate, bjNow, bjHM, bjHMS, bjYmd, bjDateTime, bjShortDateTime, bjDateLabel };
