import { ArrowLeftOutlined, LeftOutlined, RightOutlined } from "@ant-design/icons";
import { App as AntdApp, Button, Segmented, Spin, Tag } from "antd";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  fileIdOf,
  getCheckinList,
  getFileLink,
  getMe,
  type CheckinRecord,
  type CheckinRule,
  type DataScope,
  type OaIdentity,
} from "@/api/oaApi";
import {
  buildCells,
  fmtDate,
  fmtDistance,
  fmtTime,
  ipLocationTag,
  placeText,
  shiftMonth,
  statusColor,
  ymd,
  type DayState,
} from "@/pages/checkin/utils";

import { stateOfDay } from "./dayState";
import MonthCalendar, { type DayPair } from "./MonthCalendar";
import ReportView from "./ReportView";
import TeamView from "./TeamView";
import styles from "./index.module.scss";

const STATE_TEXT: Record<DayState, string> = {
  done: "已打卡",
  partial: "缺一次卡",
  absent: "缺卡",
  in_progress: "上班中，未打下班卡",
  weekend: "周末休息",
  future: "还未到",
  idle: "无记录",
};

type ViewKey = "mine" | "team" | "report";

export const Attendance = () => {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();

  const todayKey = ymd(new Date());
  const curMonth = todayKey.slice(0, 7);

  const [me, setMe] = useState<OaIdentity | null>(null);
  const [view, setView] = useState<ViewKey>("mine");
  const [scope, setScope] = useState<DataScope>("team");
  const [calMonth, setCalMonth] = useState(curMonth);
  const [rule, setRule] = useState<CheckinRule | undefined>();

  // 身份决定能不能看到「团队 / 报表」两档，不在前端按角色硬编码
  useEffect(() => {
    void (async () => {
      try {
        const identity = await getMe();
        setMe(identity);
        if (identity.can_view_team) setView("team");
      } catch {
        // 取身份失败不影响自己看自己的出勤
      }
    })();
  }, []);

  const canViewTeam = !!me?.can_view_team;
  const canViewAll = !!me?.can_view_all;

  // 稳定引用：内联箭头函数传给子组件会让它们每次渲染都重新拉数据
  const handleError = useCallback((m: string) => message.error(m), [message]);

  // ---------- 我的出勤 ----------
  const [selected, setSelected] = useState(todayKey);
  const [records, setRecords] = useState<CheckinRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const loadMine = useCallback(
    async (m: string) => {
      setLoading(true);
      try {
        const res = await getCheckinList(m);
        setRecords(res.list);
        if (res.rule) setRule(res.rule);
      } catch (e) {
        setRecords([]);
        message.error(e instanceof Error ? e.message : "出勤记录加载失败");
      } finally {
        setLoading(false);
      }
    },
    [message],
  );

  useEffect(() => {
    if (view !== "mine") return;
    void loadMine(calMonth);
  }, [calMonth, view, loadMine]);

  const byDate = useMemo(() => {
    const map = new Map<string, DayPair>();
    for (const r of records) {
      const e = map.get(r.date) ?? {};
      if (r.type === "on") e.on = r;
      else e.off = r;
      map.set(r.date, e);
    }
    return map;
  }, [records]);

  const cells = useMemo(() => buildCells(calMonth), [calMonth]);
  const monthHasData = records.length > 0;

  const dayState = useCallback(
    (date: string) => stateOfDay(byDate.get(date), date, todayKey, new Date(), rule),
    [byDate, todayKey, rule],
  );

  // 出勤/迟到/早退/缺卡：只算已过完的工作日，"今天还没下班"不算缺卡
  const summary = useMemo(() => {
    let attend = 0;
    let late = 0;
    let early = 0;
    let absent = 0;
    let partial = 0;
    if (!monthHasData) return { attend, late, early, absent, partial };
    for (const date of cells) {
      if (!date) continue;
      const st = dayState(date);
      const e = byDate.get(date);
      if (st === "weekend" || st === "future" || st === "idle") continue;
      if (e?.on) {
        attend += 1;
        if (e.on.status === "late") late += 1;
      }
      if (e?.off?.status === "early") early += 1;
      if (st === "absent") absent += 1;
      if (st === "partial") partial += 1;
    }
    return { attend, late, early, absent, partial };
  }, [byDate, cells, dayState, monthHasData]);

  const goMonth = (delta: number) => {
    const m = shiftMonth(calMonth, delta);
    setCalMonth(m);
    setSelected(m === curMonth ? todayKey : `${m}-01`);
  };

  const openPhoto = async (record?: CheckinRecord | null) => {
    if (!record?.photo_url) return;
    const id = fileIdOf(record.photo_url);
    if (!id) {
      message.error("照片地址无效");
      return;
    }
    try {
      const link = await getFileLink(id);
      window.open(link.signed_url, "_blank", "noopener");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "照片打开失败");
    }
  };

  const selRecords = byDate.get(selected);
  const selRows: { label: string; rec?: CheckinRecord }[] = [
    { label: "上班", rec: selRecords?.on },
    { label: "下班", rec: selRecords?.off },
  ];

  const tabs: { label: string; value: ViewKey; show: boolean }[] = [
    { label: "我的出勤", value: "mine", show: true },
    { label: "团队出勤", value: "team", show: canViewTeam },
    { label: "出勤报表", value: "report", show: canViewTeam || canViewAll },
  ];

  const showMonthNav = view !== "report";

  return (
    <div className={styles["att-page"]}>
      <div className={styles["att-topbar"]}>
        <div className={styles["att-topbar-left"]}>
          <ArrowLeftOutlined onClick={() => navigate("/work")} />
          <span>出勤记录</span>
        </div>
        {showMonthNav && (
          <div className={styles["att-month-nav"]}>
            <Button
              type="text"
              size="small"
              className={styles["att-nav-btn"]}
              icon={<LeftOutlined />}
              onClick={() => goMonth(-1)}
            />
            <span className={styles["att-month"]}>{calMonth.replace("-", " 年 ")} 月</span>
            <Button
              type="text"
              size="small"
              className={styles["att-nav-btn"]}
              icon={<RightOutlined />}
              disabled={calMonth >= curMonth}
              onClick={() => goMonth(1)}
            />
            <a
              className={styles["att-back-month"]}
              onClick={() => {
                setCalMonth(curMonth);
                setSelected(todayKey);
              }}
            >
              回到本月
            </a>
          </div>
        )}
      </div>

      <div className={styles["att-subbar"]}>
        <Segmented
          className={styles["view-switch"]}
          value={view}
          onChange={(v) => setView(v as ViewKey)}
          options={tabs.filter((t) => t.show).map((t) => ({ label: t.label, value: t.value }))}
        />
        <div className={styles["att-rule"]}>
          工作时间 {rule?.work_on_time || "09:05"} 上班 · {rule?.work_off_time || "18:00"} 下班
        </div>
      </div>

      <div className={styles["att-body"]}>
        <div className={styles["att-inner"]}>
          {view === "mine" && (
            <Spin spinning={loading}>
              <div className={styles["att-summary"]}>
                <div className={styles["att-stat"]}>
                  <span className={styles["att-stat-num"]}>{summary.attend}</span>
                  <span className={styles["att-stat-label"]}>出勤天数</span>
                </div>
                <div className={styles["att-stat"]}>
                  <span className={clsx(styles["att-stat-num"], styles["is-warn"])}>
                    {summary.late}
                  </span>
                  <span className={styles["att-stat-label"]}>迟到次数</span>
                </div>
                <div className={styles["att-stat"]}>
                  <span className={clsx(styles["att-stat-num"], styles["is-warn"])}>
                    {summary.early}
                  </span>
                  <span className={styles["att-stat-label"]}>早退次数</span>
                </div>
                <div className={styles["att-stat"]}>
                  <span className={clsx(styles["att-stat-num"], styles["is-danger"])}>
                    {summary.absent}
                  </span>
                  <span className={styles["att-stat-label"]}>缺卡天数</span>
                </div>
                <div className={styles["att-legend"]}>
                  <span>
                    <i className={styles["dot-done"]} />
                    两次卡齐全
                  </span>
                  <span>
                    <i className={styles["dot-partial"]} />
                    缺一次卡
                  </span>
                  <span>
                    <i className={styles["dot-absent"]} />
                    缺卡
                  </span>
                  <span>
                    <i className={styles["dot-rest"]} />
                    周末 / 未到
                  </span>
                </div>
              </div>

              <div className={styles["att-columns"]}>
                <div className={styles["att-cal-card"]}>
                  <div className={styles["att-cal-hint"]}>
                    {monthHasData ? "点日期查看当天明细" : "该月没有打卡记录"}
                  </div>
                  <MonthCalendar
                    month={calMonth}
                    cells={cells}
                    byDate={byDate}
                    todayKey={todayKey}
                    selected={selected}
                    onSelect={setSelected}
                    hasData={monthHasData}
                    stateOf={dayState}
                  />
                </div>

                <div className={styles["att-detail-card"]}>
                  <div className={styles["att-detail-head"]}>
                    <span className={styles["att-detail-date"]}>{fmtDate(selected)}</span>
                    <span className={styles["att-detail-state"]}>
                      {STATE_TEXT[dayState(selected)]}
                    </span>
                  </div>
                  <div className={styles["att-rows"]}>
                    {selRows.map(({ label, rec }) => (
                      <div key={label} className={styles["att-row"]}>
                        <span className={styles["att-row-label"]}>{label}</span>
                        <span className={styles["att-row-time"]}>
                          {rec ? fmtTime(rec.checkin_time) : "--:--"}
                        </span>
                        {rec ? (
                          <Tag color={statusColor[rec.status]}>{rec.status_text}</Tag>
                        ) : (
                          <span className={styles["att-row-miss"]}>未打卡</span>
                        )}
                        <span className={styles["att-row-place"]}>
                          {rec ? placeText(rec) || "—" : "—"}
                        </span>
                        {ipLocationTag(rec) && <Tag color="blue">IP 定位</Tag>}
                        {rec?.location_accuracy === "precise" &&
                          rec.fence_set &&
                          !rec.in_fence &&
                          !!rec.distance && (
                            <span className={styles["att-out-fence"]}>
                              范围外 {fmtDistance(rec.distance)}
                            </span>
                          )}
                        {rec?.photo_url && (
                          <span className={styles["att-photo-link"]} onClick={() => openPhoto(rec)}>
                            查看照片
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  <a className={styles["att-today-link"]} onClick={() => navigate("/checkin")}>
                    去拍照打卡 →
                  </a>
                </div>
              </div>
            </Spin>
          )}

          {view === "team" && (
            <TeamView
              month={calMonth}
              todayKey={todayKey}
              scope={scope}
              canViewAll={canViewAll}
              onScopeChange={setScope}
              onRule={setRule}
              onError={handleError}
            />
          )}

          {view === "report" && (
            <ReportView
              month={calMonth}
              scope={scope}
              canViewAll={canViewAll}
              onScopeChange={setScope}
              onRule={setRule}
              onError={handleError}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default Attendance;
