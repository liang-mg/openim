import { Drawer, Segmented, Spin, Switch, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getMemberCheckin,
  getTeamCheckin,
  type CheckinRule,
  type CheckinRecord,
  type DataScope,
  type TeamCheckinResult,
  type TeamMemberRow,
} from "@/api/oaApi";
import { fmtDate, fmtTime, statusColor } from "@/pages/checkin/utils";

import { stateOfDay } from "./dayState";
import MonthCalendar, { type DayPair } from "./MonthCalendar";
import styles from "./index.module.scss";

const TODAY_STATE_TEXT: Record<string, string> = {
  done: "已打卡",
  partial: "缺一次卡",
  absent: "未打卡",
  leave: "已批准请假",
  in_progress: "上班中",
  rest: "休息",
  not_yet: "未到点",
};

interface Props {
  month: string;
  todayKey: string;
  selectedDate?: string;
  scope: DataScope;
  departmentId?: string;
  canViewAll: boolean;
  onScopeChange: (s: DataScope) => void;
  onRule?: (r: CheckinRule) => void;
  onError: (msg: string) => void;
}

/**
 * 团队出勤：组长打开就能看到"今天谁没来、本月谁迟到多"。
 * 不是月历 —— 月历是点进某个人才看的详情，日常不需要天天翻 30 个格子。
 */
const TeamView = ({
  month,
  todayKey,
  selectedDate,
  scope,
  departmentId,
  canViewAll,
  onScopeChange,
  onRule,
  onError,
}: Props) => {
  const [data, setData] = useState<TeamCheckinResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [onlyException, setOnlyException] = useState(false);

  const [drawerUser, setDrawerUser] = useState<{ id: string; name: string } | null>(null);
  const [drawerRecords, setDrawerRecords] = useState<CheckinRecord[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerRule, setDrawerRule] = useState<CheckinRule | undefined>();
  const [drawerCalendar, setDrawerCalendar] = useState<Record<string, CheckinRule>>({});
  const [drawerLeaveDays, setDrawerLeaveDays] = useState<Record<string, boolean>>({});

  // 回调放进 ref：父组件的内联箭头函数每次渲染都是新引用，若留在依赖里会让 load 每次都变，
  // useEffect 随之每次渲染重跑 → setLoading(true) → 再渲染，表现为"一直转圈、后端被打爆"。
  const onRuleRef = useRef(onRule);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onRuleRef.current = onRule;
    onErrorRef.current = onError;
  }, [onRule, onError]);

  // 快速切月/切范围时，只认最后一次请求，避免旧响应回来把新数据覆盖掉
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const res = await getTeamCheckin({ month, scope, departmentId, onlyException, date: selectedDate });
      if (id !== reqId.current) return;
      setData(res);
      onRuleRef.current?.(res.rule);
    } catch (e) {
      if (id !== reqId.current) return;
      setData(null);
      onErrorRef.current(e instanceof Error ? e.message : "团队出勤加载失败");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [month, scope, departmentId, onlyException, selectedDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const openMember = useCallback(
    async (row: TeamMemberRow) => {
      setDrawerUser({ id: row.user_id, name: row.name });
      setDrawerLoading(true);
      try {
        const res = await getMemberCheckin(row.user_id, month);
        setDrawerRecords(res.list);
        setDrawerRule(res.rule);
        setDrawerCalendar(res.rules_by_date ?? {});
        setDrawerLeaveDays(res.approved_leave_days ?? {});
      } catch (e) {
        setDrawerRecords([]);
        setDrawerCalendar({});
        setDrawerLeaveDays({});
        onErrorRef.current(e instanceof Error ? e.message : "成员月历加载失败");
      } finally {
        setDrawerLoading(false);
      }
    },
    [month],
  );

  const drawerByDate = useMemo(() => {
    const map = new Map<string, DayPair>();
    for (const r of drawerRecords) {
      const e = map.get(r.date) ?? {};
      if (r.type === "on") e.on = r;
      else e.off = r;
      map.set(r.date, e);
    }
    return map;
  }, [drawerRecords]);

  // 抽屉里的数字直接取服务端算好的月度统计：
  // 自己再算一遍很容易和表格里的"本月出勤 / 缺卡"对不上，两处不一致比数字错更伤信任。
  const drawerSummary = useMemo(() => {
    const row = data?.members.find((m) => m.user_id === drawerUser?.id);
    return {
      attend: row?.month.attend ?? 0,
      late: row?.month.late ?? 0,
      early: row?.month.early ?? 0,
      absent: row?.month.absent ?? 0,
      partial: row?.month.partial ?? 0,
    };
  }, [data, drawerUser]);

  const columns: ColumnsType<TeamMemberRow> = [
    {
      title: "成员",
      dataIndex: "name",
      width: 190,
      render: (_, row) => (
        <div className={styles["tm-name-cell"]}>
          <span className={styles["tm-name"]}>
            {row.name}
            {row.exception && <i className={styles["tm-dot"]} />}
          </span>
          <span className={styles["tm-sub"]}>
            {row.department || "未分配"}
            {row.position ? ` · ${row.position}` : ""}
          </span>
        </div>
      ),
    },
    {
      title: "今日上班",
      dataIndex: ["today", "on"],
      width: 150,
      render: (_, row) => {
        const on = row.today.on;
        if (!on) {
          return (
            <span className={styles["tm-miss"]}>
              {TODAY_STATE_TEXT[row.today.state] || "未打卡"}
            </span>
          );
        }
        return (
          <span className={styles["tm-time-cell"]}>
            <b>{fmtTime(on.checkin_time)}</b>
            <Tag color={statusColor[on.status]}>{on.status_text}</Tag>
          </span>
        );
      },
    },
    {
      title: "今日下班",
      dataIndex: ["today", "off"],
      width: 150,
      render: (_, row) => {
        const off = row.today.off;
        if (!off) {
          return (
            <span className={styles["tm-time-cell"]}>
              <span className={styles["tm-dim"]}>—</span>
              {row.today.state === "leave" ? null : row.today.state === "in_progress" ? (
                <span className={styles["tm-progress"]}>上班中</span>
              ) : (
                <span className={styles["tm-miss"]}>未打</span>
              )}
            </span>
          );
        }
        return (
          <span className={styles["tm-time-cell"]}>
            <b>{fmtTime(off.checkin_time)}</b>
            <Tag color={statusColor[off.status]}>{off.status_text}</Tag>
          </span>
        );
      },
    },
    {
      title: "本月出勤",
      dataIndex: ["month", "attend"],
      width: 140,
      align: "center",
      render: (_, row) => (
        <Tooltip title={`应出勤 ${row.month.workdays} 天，出勤率 ${row.month.rate}%`}>
          <span className={styles["tm-attend"]}>
            <b>{row.month.attend}</b>
            <span className={styles["tm-dim"]}>/{row.month.workdays} 天</span>
          </span>
        </Tooltip>
      ),
    },
    {
      title: "迟到",
      dataIndex: ["month", "late"],
      width: 80,
      align: "center",
      render: (v: number) => (
        <span className={clsx(styles["tm-num"], v > 0 && styles["is-warn"])}>{v}</span>
      ),
    },
    {
      title: "早退",
      dataIndex: ["month", "early"],
      width: 80,
      align: "center",
      render: (v: number) => (
        <span className={clsx(styles["tm-num"], v > 0 && styles["is-warn"])}>{v}</span>
      ),
    },
    {
      title: "缺卡",
      dataIndex: ["month", "absent"],
      width: 80,
      align: "center",
      render: (v: number) => (
        <span className={clsx(styles["tm-num"], v > 0 && styles["is-danger"])}>{v}</span>
      ),
    },
    {
      title: "出勤率",
      dataIndex: ["month", "rate"],
      width: 90,
      align: "center",
      render: (v: number) => <span className={styles["tm-rate"]}>{v}%</span>,
    },
    {
      title: "",
      key: "op",
      width: 100,
      align: "right",
      render: (_, row) => (
        <a className={styles["tm-link"]} onClick={() => void openMember(row)}>
          查看月历 →
        </a>
      ),
    },
  ];

  const s = data?.summary;
  const leaveWarning = (data?.warnings || []).includes("holiday_calendar_not_integrated");

  return (
    <div className={styles["tm-wrap"]}>
      <div className={styles["tm-toolbar"]}>
        <div className={styles["tm-stats"]}>
          <span>
            应到 <b>{s?.members ?? 0}</b> 人
          </span>
          <span>
            已打卡 <b>{s?.present ?? 0}</b>
          </span>
          <span className={styles["is-danger"]}>
            未打卡 <b>{s?.absent ?? 0}</b>
          </span>
          <span className={styles["is-warn"]}>
            迟到 <b>{s?.late ?? 0}</b>
          </span>
          <span className={styles["is-warn"]}>
            早退 <b>{s?.early ?? 0}</b>
          </span>
        </div>
        <div className={styles["tm-tools"]}>
          {canViewAll && (
            <Segmented
              className={styles["view-switch"]}
              size="small"
              value={scope}
              onChange={(v) => onScopeChange(v as DataScope)}
              options={[
                { label: "我的团队", value: "team" },
                { label: "全公司", value: "all" },
              ]}
            />
          )}
          <label className={styles["tm-switch"]}>
            <Switch size="small" checked={onlyException} onChange={setOnlyException} />
            只看异常
          </label>
        </div>
      </div>

      {leaveWarning && (
        <div className={styles["tm-warn"]}>
          已批准的请假不计缺卡。工作日按公司或部门规则计算。
        </div>
      )}

      <div className={styles["tm-card"]}>
        <Spin spinning={loading}>
          <Table<TeamMemberRow>
            rowKey="user_id"
            size="middle"
            columns={columns}
            dataSource={data?.members || []}
            pagination={false}
            scroll={{ x: 980 }}
            rowClassName={(row) => (row.exception ? styles["tm-row-exception"] : "")}
            locale={{
              emptyText:
                scope === "team"
                  ? "你名下还没有成员，去「员工管理」设置直属上级后这里会自动出现"
                  : "没有符合条件的成员",
            }}
          />
        </Spin>
      </div>

      <div className={styles["tm-foot"]}>
        应到人数 = 汇报链上的全部下属（不含自己）；「今日」按 {data?.date || todayKey} 计算。
      </div>

      <Drawer
        title={drawerUser ? `${drawerUser.name} · 出勤月历` : "出勤月历"}
        placement="right"
        width={560}
        open={!!drawerUser}
        onClose={() => setDrawerUser(null)}
        destroyOnClose
      >
        <Spin spinning={drawerLoading}>
          <div className={styles["tm-drawer-sum"]}>
            <span>
              本月出勤 <b>{drawerSummary.attend}</b> 天
            </span>
            <span>
              迟到 <b>{drawerSummary.late}</b>
            </span>
            <span>
              缺卡 <b className={styles["is-danger"]}>{drawerSummary.absent}</b>
            </span>
            <span>
              单卡 <b>{drawerSummary.partial}</b>
            </span>
          </div>
          <div className={styles["tm-drawer-hint"]}>
            {month.replace("-", " 年 ")} 月 · 只读，不能替成员改卡
          </div>
          <MonthCalendar
            month={month}
            byDate={drawerByDate}
            todayKey={todayKey}
            hasData={drawerRecords.length > 0}
            compact
            stateOf={(date) =>
              stateOfDay(drawerByDate.get(date), date, todayKey, new Date(), drawerCalendar[date] ?? drawerRule, drawerLeaveDays[date])
            }
          />
          {drawerRecords.length === 0 && (
            <div className={styles["tm-drawer-hint"]}>该月没有打卡记录</div>
          )}
          <div className={styles["tm-drawer-day"]}>
            {drawerRecords.length > 0 && (
              <>
                <div className={styles["tm-drawer-hint"]}>最近打卡</div>
                {[...drawerRecords]
                  .sort((a, b) => b.checkin_time - a.checkin_time)
                  .slice(0, 6)
                  .map((r) => (
                    <div key={r.checkin_id} className={styles["tm-drawer-row"]}>
                      <span>{fmtDate(r.date)}</span>
                      <span>{r.type === "on" ? "上班" : "下班"}</span>
                      <b>{fmtTime(r.checkin_time)}</b>
                      <Tag color={statusColor[r.status]}>{r.status_text}</Tag>
                    </div>
                  ))}
              </>
            )}
          </div>
        </Spin>
      </Drawer>
    </div>
  );
};

export default TeamView;
