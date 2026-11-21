/**
 * 路由映射：后端返回的 path 是 PC 端的 web 路由（如 "/report"），
 * 移动端页面是 uni 的 /pages/xxx/index，两者不能直接混用 ——
 * 直接用 `uni.navigateTo({ url: "/report" })` 会静默失败（页面不动，控制台只有一条 fail）。
 *
 * 所以凡是「后端给 path，前端跳转」的地方都走这里，映射不到就明确提示，而不是装作点了。
 */
const MAP = [
  ["/report-review", "/pages/report-review/index"],
  ["/oa-admin", "/pages/oa-admin/index"],
  ["/approvals", "/pages/approvals/index"],
  ["/attendance", "/pages/attendance/index"],
  ["/checkin", "/pages/checkin/index"],
  ["/report", "/pages/report/index"],
  ["/leave", "/pages/leave/index"],
  ["/work", "/pages/work/index"],
  ["/mine", "/pages/mine/index"],
  ["/chat", "/pages/message/index"],
  ["/contact", "/pages/contact/index"],
];

/**
 * web 路由 → uni 页面地址。
 * @param {string} path 例如 "/report" 或 "/approvals?tab=pending"
 * @returns {string} uni 页面地址；映射不到返回 ""
 */
export function toUniPath(path) {
  const p = String(path || "").split("?")[0];
  if (!p) return "";
  // 已经是 uni 页面地址就原样返回
  if (p.startsWith("/pages/")) return String(path);
  const hit = MAP.find(([prefix]) => p === prefix || p.startsWith(`${prefix}/`));
  if (!hit) return "";
  const query = String(path).includes("?") ? String(path).slice(String(path).indexOf("?")) : "";
  return `${hit[1]}${query}`;
}

export default toUniPath;
