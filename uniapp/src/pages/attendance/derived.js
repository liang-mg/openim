/**
 * 出勤页专用的派生计算（只被 pages/attendance 使用）。
 *
 * 页面只保留「取数 + 状态 + 编排」，分组 / 汇总 / 明细格式化集中在这里：
 *  - day-detail 组件只渲染页面格式化后的行，不反向依赖 utils/checkin，
 *    避免「月历判定」和「明细判定」两处口径分叉；
 *  - 单日状态判定在共享层 utils/checkin.js（本人出勤与成员月历共用）；
 *    本文件只负责把 leave（已批准请假）等状态编排成组件用的展示数据。
 */
import { STATE_TEXT, fmtDate, fmtDistance, fmtTime, placeText, stateOfDay } from "@/utils/checkin";

/** 单日状态 → status-tag 的 tone（取值见 components/status-tag.vue） */
const STATE_TONE = { done: "success", partial: "pending", absent: "danger", leave: "success", in_progress: "info" };

/** 打卡状态 → 主题 token 类（不写 hex，语义与 PC 端 STATUS_COLOR 一致） */
const STATUS_TONE = {
  normal: "text-ok-text",
  late: "text-warn-text",
  early: "text-warn-text",
  location_abnormal: "text-danger",
  makeup: "text-brand",
};

/** 记录列表 → { "YYYY-MM-DD": { on, off } } */
export function groupByDate(list) {
  const map = {};
  (list || []).forEach((r) => {
    const pair = map[r.date] || {};
    if (r.type === "on") pair.on = r;
    else pair.off = r;
    map[r.date] = pair;
  });
  return map;
}

/** 我的出勤：当月汇总（请假 / 周末 / 未到 / 无记录不计入；该月无记录时全零） */
export function summarizeMonth(cells, byDate, todayKey, now, rule, hasData, leaveDays = {}) {
  const out = { attend: 0, late: 0, early: 0, absent: 0, partial: 0 };
  if (!hasData) return out;
  cells.forEach((date) => {
    if (!date) return;
    const pair = byDate[date];
    const state = stateOfDay(pair, date, todayKey, now, rule, Boolean(leaveDays[date]));
    // 已批准的请假日不算缺卡、不算单卡，也不计出勤（口径与 PC / 服务端一致）
    if (state === "leave" || state === "weekend" || state === "future" || state === "idle") return;
    if (pair && pair.on) {
      out.attend += 1;
      if (pair.on.status === "late") out.late += 1;
    }
    if (pair && pair.off && pair.off.status === "early") out.early += 1;
    if (state === "absent") out.absent += 1;
    if (state === "partial") out.partial += 1;
  });
  return out;
}

/** 一行明细：未打卡时只保留占位文案，不暴露记录对象给组件 */
function rowOf(label, rec) {
  if (!rec) return { label, time: "--:--", place: "—", miss: true };
  return {
    label,
    time: fmtTime(rec.checkin_time),
    status: rec.status_text,
    tone: STATUS_TONE[rec.status] || "text-ink-3",
    place: placeText(rec) || "—",
    miss: false,
  };
}

/**
 * 已批准请假日期的兜底推导：把请假记录展开成 { "YYYY-MM-DD": true }，只保留指定月份。
 *
 * 为什么需要：新后端在 /checkin/list 里直接下发 approved_leave_days，
 * 但旧版服务端没有这个字段（部署未升级时就会缺）。这时用「我的请假列表」自己算一份，
 * 保证月历不会因为后端版本不同而少显示请假态；新字段存在时优先用字段。
 */
export function leaveDaysFromLeaveList(list, month) {
  const map = {};
  const [y, m] = String(month || "").split("-").map(Number);
  if (!y || !m) return map;
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd = new Date(y, m, 0);
  (list || []).forEach((r) => {
    if (!r || r.status !== "approved" || !r.start_date) return;
    const start = new Date(`${r.start_date}T00:00:00`);
    const end = new Date(`${r.end_date || r.start_date}T00:00:00`);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (d < monthStart || d > monthEnd) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      map[key] = true;
    }
  });
  return map;
}

/** 选中日 → 明细卡的全部展示数据（日期 / 状态标签 / 请假提示 / 两行明细 / 照片 / 范围外距离） */
export function dayDetailOf(date, pair, todayKey, now, rule, isLeave = false) {
  const cur = pair || {};
  const on = cur.on || null;
  const off = cur.off || null;
  const fence = on || off;
  const state = stateOfDay(cur, date, todayKey, now, rule, isLeave);
  return {
    dateText: fmtDate(date),
    stateText: STATE_TEXT[state] || "",
    stateTone: STATE_TONE[state] || "muted",
    // 请假日明细必须给出「不算缺卡」的解释，否则上下班两行都显示未打卡会误导
    hint: isLeave ? "当日为已批准请假，不计缺卡" : "",
    rows: [rowOf("上班", on), rowOf("下班", off)],
    photo: (on && on.photo_url && on) || (off && off.photo_url && off) || null,
    outFence:
      fence && fence.fence_set && !fence.in_fence && fence.distance
        ? `范围外 ${fmtDistance(fence.distance)}`
        : "",
  };
}
