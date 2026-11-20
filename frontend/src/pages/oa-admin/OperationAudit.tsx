import { App as AntdApp, Collapse, DatePicker, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useEffect, useState } from "react";

import { getEmployeeList, getOperationAudit, type EmployeeView, type OperationAudit as AuditEvent } from "@/api/oaApi";

import styles from "./index.module.scss";

const ACTIONS: Record<string, string> = {
  employee_update: "保存员工档案",
  employee_disable: "停用或启用员工",
  department_save: "保存部门",
  department_migrate: "批量关联旧部门",
  checkin_correct: "补卡更正",
  exception_handle: "处理考勤异常",
  report_read: "查阅日报",
  contract_save: "保存员工合同",
};

const RESULTS: Record<string, { text: string; color: string }> = {
  success: { text: "成功", color: "green" },
  denied: { text: "拒绝", color: "red" },
  failed: { text: "失败", color: "red" },
  partial: { text: "部分完成", color: "orange" },
};

const FIELDS: Record<string, string> = {
  real_name: "姓名",
  department: "部门",
  department_id: "部门 ID",
  name: "名称",
  parent_id: "上级部门",
  head_id: "负责人",
  linked: "关联人数",
  position: "岗位",
  role: "角色",
  manager_id: "直属上级",
  is_admin: "管理员权限",
  disabled: "停用状态",
  user_id: "员工",
  makeup_id: "补卡申请",
  date: "日期",
  type: "卡类型",
  time: "补卡时间",
  status: "状态",
  start_date: "开始日期",
  end_date: "到期日期",
  attachment_count: "附件数",
};

function showValue(value?: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "是" : "否";
  return value === undefined || value === "" ? "—" : String(value);
}

function AuditTable() {
  const { message } = AntdApp.useApp();
  const [employees, setEmployees] = useState<EmployeeView[]>([]);
  const [actor, setActor] = useState<string>();
  const [action, setAction] = useState<string>();
  const [dates, setDates] = useState({ from: "", to: "" });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{ total: number; page_size: number; list: AuditEvent[] }>({
    total: 0,
    page_size: 30,
    list: [],
  });

  useEffect(() => {
    let alive = true;
    void getEmployeeList({ includeDisabled: true }).then(({ list }) => {
      if (alive) setEmployees(list);
    }).catch(() => {
      if (alive) message.error("加载操作人列表失败");
    });
    return () => { alive = false; };
  }, [message]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void getOperationAudit({ actor_id: actor, action, ...dates, page }).then((response) => {
      if (alive) setData(response);
    }).catch((e: unknown) => {
      if (alive) message.error(e instanceof Error ? e.message : "加载操作审计失败");
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [actor, action, dates, page, message]);

  const names = new Map(employees.map((employee) => [employee.user_id, employee.real_name]));
  const columns: ColumnsType<AuditEvent> = [
    {
      title: "操作时间",
      width: 170,
      render: (_, event) => dayjs(event.occurred_at).format("YYYY-MM-DD HH:mm:ss"),
    },
    {
      title: "操作人",
      dataIndex: "actor_id",
      width: 120,
      render: (id: string) => names.get(id) || id,
    },
    {
      title: "事件",
      dataIndex: "action",
      width: 140,
      render: (value: string) => ACTIONS[value] || value,
    },
    { title: "对象 ID", dataIndex: "target_id", width: 200 },
    {
      title: "结果",
      dataIndex: "result",
      width: 100,
      render: (value: string) => <Tag color={RESULTS[value]?.color}>{RESULTS[value]?.text || value}</Tag>,
    },
    {
      title: "变更",
      render: (_, event) => event.changes?.length ? event.changes.map((change) => (
        <div key={change.field}>
          {FIELDS[change.field] || change.field}　{showValue(change.before)} → {showValue(change.after)}
        </div>
      )) : "—",
    },
  ];

  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Space wrap>
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          aria-label="筛选操作人"
          placeholder="操作人"
          value={actor}
          style={{ minWidth: 160 }}
          onChange={(value) => { setActor(value); setPage(1); }}
          options={employees.map((employee) => ({
            value: employee.user_id,
            label: `${employee.real_name} · ${employee.user_id}`,
          }))}
        />
        <Select
          allowClear
          aria-label="筛选事件"
          placeholder="全部事件"
          value={action}
          style={{ minWidth: 150 }}
          onChange={(value) => { setAction(value); setPage(1); }}
          options={Object.entries(ACTIONS).map(([value, label]) => ({ value, label }))}
        />
        <DatePicker.RangePicker
          placeholder={["开始日期", "结束日期"]}
          onChange={(_, [from, to]) => { setDates({ from, to }); setPage(1); }}
          format="YYYY-MM-DD"
        />
      </Space>
      <Table
        rowKey="audit_id"
        columns={columns}
        dataSource={data.list}
        loading={loading}
        size="small"
        scroll={{ x: 940 }}
        locale={{ emptyText: "暂无操作记录" }}
        pagination={{
          current: page,
          pageSize: data.page_size,
          total: data.total,
          showSizeChanger: false,
          onChange: setPage,
        }}
      />
    </Space>
  );
}

export function OperationAudit() {
  return (
    <section className={styles["rule-card"]} aria-label="操作审计">
      <Collapse ghost items={[{ key: "audit", label: "操作审计", children: <AuditTable /> }]} />
    </section>
  );
}
