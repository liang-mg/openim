import { ArrowLeftOutlined } from "@ant-design/icons";
import { DatePicker, Empty, Select, Spin } from "antd";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  getManagementDashboard,
  getMe,
  getVisibleDepartments,
  type DataScope,
  type DepartmentOption,
  type ManagementDashboardResult,
  type OaIdentity,
} from "@/api/oaApi";

import styles from "./index.module.scss";

function drillPath(path: string, params: Record<string, string>) {
  return `${path}?${new URLSearchParams(params)}`;
}

export const ManagementDashboard = () => {
  const [identity, setIdentity] = useState<OaIdentity | null>();
  const [scope, setScope] = useState<DataScope>("team");
  const [department, setDepartment] = useState<string>();
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [date, setDate] = useState(dayjs());
  const [data, setData] = useState<ManagementDashboardResult>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const canView = !!identity && !identity.disabled && (identity.can_view_team || identity.can_view_all);
  const selectedDate = date.format("YYYY-MM-DD");

  useEffect(() => {
    let active = true;
    void getMe().then((result) => {
      if (!active) return;
      setScope(result.can_view_all ? "all" : "team");
      setIdentity(result);
    }).catch(() => {
      if (active) setIdentity(null);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!canView) return;
    let active = true;
    void getVisibleDepartments(scope).then((result) => {
      if (active) setDepartments(result);
    }).catch(() => {
      if (active) setDepartments([]);
    });
    return () => { active = false; };
  }, [canView, scope]);

  useEffect(() => {
    if (!canView) return;
    let active = true;
    setLoading(true);
    setError("");
    void getManagementDashboard(selectedDate, scope, department).then((result) => {
      if (active) setData(result);
    }).catch((e: unknown) => {
      if (!active) return;
      setData(undefined);
      setError(e instanceof Error ? e.message : "加载看板失败");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [canView, selectedDate, scope, department]);

  const filters = { scope, ...(department ? { department_id: department } : {}) };
  const attendancePath = drillPath("/attendance", { ...filters, view: "report", month: data?.month || selectedDate.slice(0, 7) });
  const maxExceptions = Math.max(1, ...(data?.daily_trend ?? []).map((day) => day.count));

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/work" aria-label="返回工作台"><ArrowLeftOutlined /></Link>
        <h1>管理看板</h1>
      </header>
      <main className={styles.main}>
        {identity === undefined ? <Spin /> : !canView ? (
          <Empty description="无权查看管理看板" />
        ) : (
          <>
            <div className={styles.filters}>
              <DatePicker
                aria-label="统计日期"
                value={date}
                allowClear={false}
                disabledDate={(candidate) => candidate.isAfter(dayjs(), "day")}
                onChange={(value) => { if (value) setDate(value); }}
              />
              {identity?.can_view_all && (
                <Select<DataScope>
                  aria-label="查看范围"
                  value={scope}
                  options={[{ label: "全公司", value: "all" }, { label: "我的团队", value: "team" }]}
                  onChange={(value) => {
                    setDepartments([]);
                    setDepartment(undefined);
                    setScope(value);
                  }}
                />
              )}
              <Select
                aria-label="筛选部门"
                placeholder="全部部门"
                allowClear
                value={department}
                options={departments.map((item) => ({ label: item.name, value: item.department_id }))}
                onChange={setDepartment}
              />
            </div>
            <Spin spinning={loading}>
              {error ? <Empty description={error} /> : data && (
                <>
                  <section className={styles.cards} aria-label="统计指标">
                    <Link to={attendancePath}>
                      <span>本月出勤率</span>
                      <strong>{data.attendance.rate}%</strong>
                      <small>{data.attendance.attend} / {data.attendance.workdays} 人天</small>
                    </Link>
                    <Link to={drillPath("/approvals", { ...filters, tab: "report-rate", date: data.date })}>
                      <span>当日日报提交率</span>
                      <strong>{data.reports.rate}%</strong>
                      <small>{data.reports.done} / {data.reports.total} 人</small>
                    </Link>
                    <Link to={drillPath("/approvals", { ...filters, tab: "pending" })}>
                      <span>待我审批</span>
                      <strong>{data.approvals}</strong>
                    </Link>
                    <Link to={attendancePath}>
                      <span>本月有效考勤异常</span>
                      <strong>{data.exceptions}</strong>
                    </Link>
                  </section>
                  <section className={styles.trend}>
                    <h2>每日考勤异常</h2>
                    <div className={styles.chart}>
                      {data.daily_trend.map((day) => (
                        <Link
                          key={day.date}
                          to={drillPath("/attendance", { ...filters, view: "team", date: day.date })}
                          aria-label={`${day.date} 有效异常 ${day.count} 条，查看当天出勤`}
                          title={`${day.date} · ${day.count} 条`}
                        >
                          <span className={styles.bar} style={{ height: `${(day.count / maxExceptions) * 112}px` }} />
                          <span>{day.date.slice(-2)}</span>
                        </Link>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </Spin>
          </>
        )}
      </main>
    </div>
  );
};
