import type { CheckinRule } from "@/api/oaApi";
import { hmMinutes, type DayState } from "@/pages/checkin/utils";

import type { DayPair } from "./MonthCalendar";

/**
 * 单日状态判定 —— 前端唯一一份实现，本人出勤、组员月历都用它。
 * 必须和服务端 `dayStatusOf` 口径一致，否则会出现"组长看到缺卡、
 * 员工自己看到正常"这种最伤信任的差异。
 */
export function stateOfDay(
  pair: DayPair | undefined,
  date: string,
  todayKey: string,
  now: Date,
  rule?: CheckinRule,
): DayState {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const onMin = hmMinutes(rule?.work_on_time || "09:05");
  const offMin = hmMinutes(rule?.work_off_time || "18:00");

  const hasOn = !!pair?.on;
  const hasOff = !!pair?.off;

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
