import clsx from "clsx";

import type { CheckinRecord } from "@/api/oaApi";
import { buildCells, fmtTime, WEEK_LABELS, type DayState } from "@/pages/checkin/utils";

import styles from "./index.module.scss";

export interface DayPair {
  on?: CheckinRecord;
  off?: CheckinRecord;
}

interface Props {
  month?: string;
  /** 不传就按 month 现算，传了就复用调用方算好的格子 */
  cells?: (string | null)[];
  byDate: Map<string, DayPair>;
  todayKey: string;
  selected?: string;
  onSelect?: (date: string) => void;
  /** 该月有没有任何记录；没有就不把工作日刷成"缺卡" */
  hasData: boolean;
  /** 取自服务端 / 本人页面的判定；不传则用本地兜底逻辑 */
  stateOf?: (date: string) => DayState;
  compact?: boolean;
}

/**
 * 月历（一天一格，上下班时间分两行）。
 * 本人出勤页和"组长看组员"的抽屉共用同一个组件，
 * 免得两处判定口径不一样——一处显示正常、另一处标红是最容易让人不信的 bug。
 */
const MonthCalendar = ({
  month,
  cells,
  byDate,
  todayKey,
  selected,
  onSelect,
  hasData,
  stateOf,
  compact,
}: Props) => {
  const grid = cells ?? (month ? buildCells(month) : []);

  const fallbackState = (date: string): DayState => {
    const e = byDate.get(date);
    if (e?.on && e?.off) return "done";
    if (e?.on || e?.off) return "partial";
    if (date > todayKey) return "future";
    const d = new Date(`${date}T00:00:00`);
    if (d.getDay() === 0 || d.getDay() === 6) return "weekend";
    return hasData ? "absent" : "idle";
  };

  return (
    <>
      <div className={styles["att-week"]}>
        {WEEK_LABELS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className={clsx(styles["att-grid"], compact && styles["is-compact"])}>
        {grid.map((date, idx) => {
          if (!date) return <div key={`blank-${idx}`} className={styles["att-blank"]} />;
          const st = (stateOf ?? fallbackState)(date);
          const e = byDate.get(date);
          return (
            <button
              key={date}
              type="button"
              className={clsx(styles["att-cell"], styles[`att-${st}`], {
                [styles["is-today"]]: date === todayKey,
                [styles["is-selected"]]: date === selected,
              })}
              onClick={() => onSelect?.(date)}
            >
              <span className={styles["att-day"]}>{Number(date.slice(8, 10))}</span>
              {e?.on || e?.off ? (
                <span className={styles["att-times"]}>
                  <span className={e?.on && e.on.status !== "normal" ? styles["att-t-warn"] : undefined}>
                    {e?.on ? fmtTime(e.on.checkin_time) : "—"}
                  </span>
                  <span
                    className={e?.off && e.off.status !== "normal" ? styles["att-t-warn"] : undefined}
                  >
                    {e?.off ? fmtTime(e.off.checkin_time) : "—"}
                  </span>
                </span>
              ) : st === "absent" ? (
                <span className={styles["att-miss"]}>缺卡</span>
              ) : st === "in_progress" ? (
                <span className={styles["att-progress"]}>进行中</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </>
  );
};

export default MonthCalendar;
