import { ArrowLeftOutlined } from "@ant-design/icons";
import { App as AntdApp, Button, DatePicker, Form, Input, Modal, Segmented, Select, Spin, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  approveLeave,
  approveMakeup,
  cancelLeave,
  cancelMakeup,
  getLeaveList,
  getMakeupList,
  getMe,
  LEAVE_TYPE_TEXT,
  REQUEST_STATUS_TEXT,
  submitLeave,
  submitMakeup,
  type DataScope,
  type LeaveRequest,
  type LeaveType,
  type MakeupRequest,
  type OaIdentity,
  type RequestStatus,
} from "@/api/oaApi";

import styles from "./index.module.scss";

const STATUS_COLOR: Record<RequestStatus, string> = {
  pending: "gold", approved: "green", rejected: "red", cancelled: "default",
};

type TabKey = "mine" | "pending" | "done";

export const Leave = () => {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [me, setMe] = useState<OaIdentity | null>(null);
  const [tab, setTab] = useState<TabKey>("mine");
  const [scope, setScope] = useState<DataScope>("team");
  const [leaveList, setLeaveList] = useState<LeaveRequest[]>([]);
  const [makeupList, setMakeupList] = useState<MakeupRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"leave" | "makeup" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [leaveForm] = Form.useForm();
  const [makeupForm] = Form.useForm();

  const handleError = useCallback((e: unknown, fallback: string) => {
    message.error(e instanceof Error ? e.message : fallback);
  }, [message]);

  useEffect(() => {
    void getMe().then(setMe).catch(() => {});
  }, []);

  const canReview = !!me?.can_view_team;
  const canAll = !!me?.can_view_all;
  // 待我审批只取 pending；已处理取其他状态；用 scope 决定看下属还是全公司
  const listScope: DataScope = tab === "mine" ? "mine" : scope;
  const listStatus: RequestStatus | undefined =
    tab === "pending" ? "pending" : tab === "done" ? undefined : undefined;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [lv, mk] = await Promise.all([
        getLeaveList({ scope: listScope, status: listStatus }),
        getMakeupList({ scope: listScope, status: listStatus }),
      ]);
      let leaves = lv.list || [];
      let makeups = mk.list || [];
      // "已处理"页排除 pending（上面没传 status，这里前端再滤一次，口径与后端一致）
      if (tab === "done") {
        leaves = leaves.filter((x) => x.status !== "pending");
        makeups = makeups.filter((x) => x.status !== "pending");
      }
      setLeaveList(leaves);
      setMakeupList(makeups);
    } catch (e) {
      handleError(e, "加载失败");
      setLeaveList([]);
      setMakeupList([]);
    } finally {
      setLoading(false);
    }
  }, [listScope, listStatus, tab, handleError]);

  useEffect(() => { void load(); }, [load]);

  const [approval, setApproval] = useState<{
    kind: "leave" | "makeup"; id: string; action: "approve" | "reject"; comment: string;
  } | null>(null);

  const doApprove = useCallback(async () => {
    if (!approval) return;
    if (!approval.comment.trim()) { message.warning("请填写审批意见"); return; }
    try {
      if (approval.kind === "leave") await approveLeave(approval.id, approval.action, approval.comment.trim());
      else await approveMakeup(approval.id, approval.action, approval.comment.trim());
      message.success(approval.action === "approve" ? "已通过" : "已拒绝");
      setApproval(null);
      void load();
    } catch (e) { handleError(e, "审批失败"); }
  }, [approval, load, handleError, message]);

  const askApprove = useCallback((kind: "leave" | "makeup", id: string, action: "approve" | "reject") => {
    setApproval({ kind, id, action, comment: "" });
  }, []);

  const onCancel = useCallback(async (kind: "leave" | "makeup", id: string) => {
    try {
      if (kind === "leave") await cancelLeave(id);
      else await cancelMakeup(id);
      message.success("已撤销");
      void load();
    } catch (e) { handleError(e, "撤销失败"); }
  }, [load, handleError, message]);

  const doLeave = async () => {
    try {
      const v = await leaveForm.validateFields();
      setSubmitting(true);
      await submitLeave({
        type: v.type,
        start_date: v.range[0].format("YYYY-MM-DD"),
        end_date: v.range[1].format("YYYY-MM-DD"),
        reason: v.reason,
      });
      message.success("请假申请已提交，等待上级审批");
      setModal(null); leaveForm.resetFields(); void load();
    } catch (e) { handleError(e, "提交失败"); }
    finally { setSubmitting(false); }
  };

  const doMakeup = async () => {
    try {
      const v = await makeupForm.validateFields();
      setSubmitting(true);
      await submitMakeup({
        date: v.date.format("YYYY-MM-DD"),
        type: v.type,
        time: v.time,
        reason: v.reason,
      });
      message.success("补卡申请已提交，等待上级审批");
      setModal(null); makeupForm.resetFields(); void load();
    } catch (e) { handleError(e, "提交失败"); }
    finally { setSubmitting(false); }
  };

  const tabs: { label: string; value: TabKey; show: boolean }[] = [
    { label: "我的申请", value: "mine", show: true },
    { label: "待我审批", value: "pending", show: canReview },
    { label: "已处理", value: "done", show: canReview },
  ];

  const leaveColumns: ColumnsType<LeaveRequest> = [
    { title: "申请人", dataIndex: "user_name", key: "name", width: 100 },
    { title: "类型", dataIndex: "type", key: "type", width: 80, render: (t: LeaveType) => LEAVE_TYPE_TEXT[t] || t },
    {
      title: "请假时间", key: "range", render: (_, r) => (
        <span className={styles["cell-mono"]}>{r.start_date}{r.end_date !== r.start_date ? ` ~ ${r.end_date}` : ""}</span>
      ),
    },
    { title: "天数", dataIndex: "days", key: "days", width: 64, render: (d: number) => `${d} 天` },
    { title: "事由", dataIndex: "reason", key: "reason", ellipsis: true },
    {
      title: "状态", dataIndex: "status", key: "status", width: 88,
      render: (s: RequestStatus) => <Tag color={STATUS_COLOR[s]}>{REQUEST_STATUS_TEXT[s]}</Tag>,
    },
    {
      title: "审批人", key: "approver", width: 100,
      render: (_, r) => r.approver_name || (r.status === "pending" ? "待指派" : "—"),
    },
    {
      title: "操作", key: "op", width: 150,
      render: (_, r) => (
        <div className={styles["op-cell"]}>
          {tab !== "mine" && r.status === "pending" && (
            <>
              <a onClick={() => void askApprove("leave", r.leave_id, "approve")}>同意</a>
              <a onClick={() => void askApprove("leave", r.leave_id, "reject")}>拒绝</a>
            </>
          )}
          {tab === "mine" && r.status === "pending" && (
            <a onClick={() => void onCancel("leave", r.leave_id)}>撤销</a>
          )}
          {(r.comment || r.status !== "pending") && <span className={styles["op-comment"]} title={r.comment}>{r.comment || "—"}</span>}
        </div>
      ),
    },
  ];

  const makeupColumns: ColumnsType<MakeupRequest> = [
    { title: "申请人", dataIndex: "user_name", key: "name", width: 100 },
    {
      title: "补卡时间", key: "time", width: 160,
      render: (_, r) => <span className={styles["cell-mono"]}>{r.date} {r.time} {r.type === "on" ? "上班" : "下班"}</span>,
    },
    { title: "原因", dataIndex: "reason", key: "reason", ellipsis: true },
    {
      title: "状态", dataIndex: "status", key: "status", width: 88,
      render: (s: RequestStatus) => <Tag color={STATUS_COLOR[s]}>{REQUEST_STATUS_TEXT[s]}</Tag>,
    },
    { title: "审批人", dataIndex: "approver_name", key: "approver", width: 100, render: (v: string) => v || "—" },
    {
      title: "操作", key: "op", width: 150,
      render: (_, r) => (
        <div className={styles["op-cell"]}>
          {tab !== "mine" && r.status === "pending" && (
            <>
              <a onClick={() => void askApprove("makeup", r.makeup_id, "approve")}>同意</a>
              <a onClick={() => void askApprove("makeup", r.makeup_id, "reject")}>拒绝</a>
            </>
          )}
          {tab === "mine" && r.status === "pending" && (
            <a onClick={() => void onCancel("makeup", r.makeup_id)}>撤销</a>
          )}
          <span className={styles["op-comment"]} title={r.comment}>{r.comment || "—"}</span>
        </div>
      ),
    },
  ];

  const total = leaveList.length + makeupList.length;

  return (
    <div className={styles["lv-page"]}>
      <div className={styles["lv-topbar"]}>
        <div className={styles["lv-topbar-left"]}>
          <ArrowLeftOutlined onClick={() => navigate("/work")} />
          <span>请假与补卡</span>
        </div>
        <div className={styles["lv-topbar-right"]}>
          <Button size="small" onClick={() => setModal("makeup")}>申请补卡</Button>
          <Button size="small" type="primary" onClick={() => setModal("leave")}>申请请假</Button>
        </div>
      </div>

      <div className={styles["lv-subbar"]}>
        <Segmented
          className={styles["lv-segmented"]}
          value={tab}
          onChange={(v) => setTab(v as TabKey)}
          options={tabs.filter((t) => t.show).map((t) => ({ label: t.label, value: t.value }))}
        />
        {tab !== "mine" && canAll && (
          <Segmented
            className={styles["lv-segmented"]}
            size="small"
            value={scope}
            onChange={(v) => setScope(v as DataScope)}
            options={[{ label: "我的团队", value: "team" }, { label: "全公司", value: "all" }]}
          />
        )}
      </div>

      <div className={styles["lv-body"]}>
        <div className={styles["lv-inner"]}>
          <Spin spinning={loading}>
            <section className={styles["lv-section"]}>
              <div className={styles["lv-section-title"]}>
                请假申请 <span className={styles["lv-count"]}>{leaveList.length}</span>
              </div>
              <div className={styles["lv-table"]}>
                <Table
                  rowKey="leave_id"
                  columns={leaveColumns}
                  dataSource={leaveList}
                  size="small"
                  pagination={false}
                  locale={{ emptyText: "暂无请假申请" }}
                />
              </div>
            </section>

            <section className={styles["lv-section"]}>
              <div className={styles["lv-section-title"]}>
                补卡申请 <span className={styles["lv-count"]}>{makeupList.length}</span>
              </div>
              <div className={styles["lv-table"]}>
                <Table
                  rowKey="makeup_id"
                  columns={makeupColumns}
                  dataSource={makeupList}
                  size="small"
                  pagination={false}
                  locale={{ emptyText: "暂无补卡申请" }}
                  scroll={{ x: 720 }}
                />
              </div>
            </section>
            <p className={styles["lv-hint"]}>
              共 {total} 条记录 · 请假按工作日计，周末不计天数；补卡只可补最近 7 天、每月最多 3 次。
              已批准的请假日不算缺卡，也不计入应出勤。
            </p>
          </Spin>
        </div>
      </div>

      <Modal
        title="申请请假"
        open={modal === "leave"}
        onCancel={() => setModal(null)}
        onOk={() => void doLeave()}
        okText="提交申请"
        confirmLoading={submitting}
      >
        <Form form={leaveForm} layout="vertical" initialValues={{ type: "personal" }}>
          <Form.Item name="type" label="请假类型" rules={[{ required: true }]}>
            <Select options={Object.entries(LEAVE_TYPE_TEXT).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item name="range" label="起止日期" rules={[{ required: true, message: "请选择起止日期" }]}>
            <DatePicker.RangePicker
              style={{ width: "100%" }}
              inputReadOnly={false}
              disabledDate={(d) => d && d < dayjs().startOf("day")}
            />
          </Form.Item>
          <Form.Item name="reason" label="事由" rules={[{ required: true, message: "请填写事由" }]}>
            <Input.TextArea rows={3} placeholder="简单说明请假原因" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={approval?.action === "approve" ? "同意申请" : "拒绝申请"}
        open={!!approval}
        onCancel={() => setApproval(null)}
        onOk={() => void doApprove()}
        okText={approval?.action === "approve" ? "同意" : "拒绝"}
        okButtonProps={{ danger: approval?.action === "reject" }}
      >
        <p className={styles["approval-tip"]}>审批意见会同步给申请人，请说明原因。</p>
        <Input.TextArea
          rows={3}
          placeholder="请填写审批意见（必填）"
          value={approval?.comment || ""}
          onChange={(e) => setApproval((a) => (a ? { ...a, comment: e.target.value } : a))}
        />
      </Modal>

      <Modal
        title="申请补卡"
        open={modal === "makeup"}
        onCancel={() => setModal(null)}
        onOk={() => void doMakeup()}
        okText="提交申请"
        confirmLoading={submitting}
      >
        <Form form={makeupForm} layout="vertical" initialValues={{ type: "on" }}>
          <Form.Item name="date" label="补卡日期" rules={[{ required: true, message: "请选择日期" }]}>
            <DatePicker
              style={{ width: "100%" }}
              inputReadOnly={false}
              disabledDate={(d) => d && (d > dayjs() || d < dayjs().subtract(7, "day"))}
            />
          </Form.Item>
          <Form.Item name="type" label="补哪次卡" rules={[{ required: true }]}>
            <Select options={[{ value: "on", label: "上班卡" }, { value: "off", label: "下班卡" }]} />
          </Form.Item>
          <Form.Item name="time" label="补卡时间" rules={[{ required: true, message: "请填写时间（HH:MM）" }, { pattern: /^([01]\d|2[0-3]):[0-5]\d$/, message: "格式为 HH:MM" }]}>
            <Input placeholder="例如 09:30" />
          </Form.Item>
          <Form.Item name="reason" label="原因" rules={[{ required: true, message: "请填写补卡原因" }]}>
            <Input.TextArea rows={3} placeholder="说明为什么漏打卡" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
