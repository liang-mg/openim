import { DownloadOutlined } from "@ant-design/icons";
import { Button, Segmented, Spin, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { App as AntdApp } from "antd";

import {
  downloadAttendanceCsv,
  getAttendanceReport,
  type AttendanceReport,
  type CheckinRule,
  type DataScope,
  type ReportRow,
} from "@/api/oaApi";

import styles from "./index.module.scss";

interface Props {
  month: string;
  scope: DataScope;
  canViewAll: boolean;
  onScopeChange: (s: DataScope) => void;
  onRule?: (r: CheckinRule) => void;
  onError: (msg: string) => void;
}

/**
 * 出勤报表：一人一行，底下有合计行，可以导出 CSV 给 HR 做核算。
 * 数字全部来自服务端同一次聚合，和「团队出勤」里的出勤/迟到/缺卡严格一致。
 */
const ReportView = ({ month, scope, canViewAll, onScopeChange, onRule, onError }: Props) => {
  const { message } = AntdApp.useApp();
  const [data, setData] = useState<AttendanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  // 同 TeamView：回调走 ref，load 的依赖只留请求参数，否则父组件内联箭头函数会引发无限重请求
  const onRuleRef = useRef(onRule);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onRuleRef.current = onRule;
    onErrorRef.current = onError;
  }, [onRule, onError]);

  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const res = await getAttendanceReport({ month, scope });
      if (id !== reqId.current) return;
      setData(res);
      onRuleRef.current?.(res.rule);
    } catch (e) {
      if (id !== reqId.current) return;
      setData(null);
      onErrorRef.current(e instanceof Error ? e.message : "报表加载失败");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [month, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadAttendanceCsv(month, scope);
      message.success("报表已导出，可直接用 Excel 打开");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const numCell = (v: number, tone: "warn" | "danger") => (
    <span className={clsx(styles["tm-num"], v > 0 && styles[`is-${tone}`])}>{v}</span>
  );

  const columns: ColumnsType<ReportRow> = [
    { title: "姓名", dataIndex: "name", width: 120, fixed: "left" },
    { title: "部门", dataIndex: "department", width: 120, render: (v) => v || "未分配" },
    { title: "岗位", dataIndex: "position", width: 130, render: (v) => v || "—" },
    { title: "应出勤", dataIndex: "workdays", width: 90, align: "center" },
    {
      title: "实际出勤",
      dataIndex: "attend",
      width: 100,
      align: "center",
      render: (v: number) => <b>{v}</b>,
    },
    {
      title: "出勤率",
      dataIndex: "rate",
      width: 90,
      align: "center",
      render: (v: number) => <span className={styles["tm-rate"]}>{v}%</span>,
    },
    { title: "迟到", dataIndex: "late", width: 80, align: "center", render: (v) => numCell(v, "warn") },
    { title: "早退", dataIndex: "early", width: 80, align: "center", render: (v) => numCell(v, "warn") },
    { title: "缺卡", dataIndex: "absent", width: 80, align: "center", render: (v) => numCell(v, "danger") },
    { title: "单卡", dataIndex: "partial", width: 80, align: "center", render: (v) => numCell(v, "warn") },
    {
      title: "平均上班",
      dataIndex: "avg_on",
      width: 100,
      align: "center",
      render: (v) => v || "—",
    },
    {
      title: "平均下班",
      dataIndex: "avg_off",
      width: 100,
      align: "center",
      render: (v) => v || "—",
    },
  ];

  const total = data?.total;
  const leaveWarning = (data?.warnings || []).includes("holiday_calendar_not_integrated");

  return (
    <div className={styles["tm-wrap"]}>
      <div className={styles["tm-toolbar"]}>
        <div className={styles["tm-stats"]}>
          <span>
            人数 <b>{data?.rows.length ?? 0}</b>
          </span>
          <span>
            应出勤 <b>{total?.workdays ?? 0}</b> 人天
          </span>
          <span>
            实际出勤 <b>{total?.attend ?? 0}</b> 人天
          </span>
          <span className={styles["is-danger"]}>
            缺卡 <b>{total?.absent ?? 0}</b> 人天
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
          <Button
            size="small"
            type="primary"
            icon={<DownloadOutlined />}
            loading={exporting}
            onClick={() => void exportCsv()}
          >
            导出报表
          </Button>
        </div>
      </div>

      {leaveWarning && (
        <div className={styles["tm-warn"]}>
          报表已计入已批准请假（不算缺卡、不计入应出勤）；工作日按周一至周五判，节假日日历尚未接入。
        </div>
      )}

      <div className={styles["tm-card"]}>
        <Spin spinning={loading}>
          <Table<ReportRow>
            rowKey="user_id"
            size="middle"
            columns={columns}
            dataSource={data?.rows || []}
            pagination={false}
            scroll={{ x: 1180 }}
            locale={{ emptyText: "该月没有可统计的成员" }}
            summary={() =>
              total ? (
                <Table.Summary fixed>
                  <Table.Summary.Row className={styles["rp-total-row"]}>
                    <Table.Summary.Cell index={0}>合计</Table.Summary.Cell>
                    <Table.Summary.Cell index={1}>—</Table.Summary.Cell>
                    <Table.Summary.Cell index={2}>—</Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="center">
                      {total.workdays}
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={4} align="center">
                      <b>{total.attend}</b>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={5} align="center">
                      {total.rate}%
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={6} align="center">
                      {total.late}
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={7} align="center">
                      {total.early}
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={8} align="center">
                      {total.absent}
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={9} align="center">
                      {total.partial}
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={10} align="center">
                      —
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={11} align="center">
                      —
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              ) : null
            }
          />
        </Spin>
      </div>

      <div className={styles["tm-foot"]}>
        统计口径：工作时间为 {data?.rule.work_on_time || "09:05"} 上班、
        {data?.rule.work_off_time || "18:00"} 下班；工作日按周一至周五；今天未到下班点不计入缺卡。
        生成时间 {data?.generated_at || "—"}
      </div>
    </div>
  );
};

export default ReportView;
