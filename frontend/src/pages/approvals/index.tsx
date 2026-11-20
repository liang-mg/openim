import { ArrowLeftOutlined, ReloadOutlined, SendOutlined } from "@ant-design/icons";
import {
  App as AntdApp,
  Button,
  DatePicker,
  Input,
  Modal,
  Segmented,
  Spin,
  Table,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  appealException,
  approveLeave,
  approveMakeup,
  EXCEPTION_STATUS_TEXT,
  getApprovalList,
  getMe,
  getSubmitRate,
  handleException,
  REQUEST_STATUS_TEXT,
  scanExceptions,
  urgeReports,
  type ApprovalItem,
  type ApprovalTab,
  type OaIdentity,
  type SubmitRateResult,
} from "@/api/oaApi";

import styles from "./index.module.scss";

// 审批中心：一个入口处理四类待办。
// 数字与列表都来自服务端的同一份聚合（approvalItems），前端不再自己算条数。

const STATUS_COLOR: Record<string, string> = {
  pending: "gold",
  approved: "green",
  rejected: "red",
  cancelled: "default",
  open: "gold",
  appealed: "blue",
  resolved: "green",
  ignored: "default",
  submitted: "gold",
  pending_leader: "blue",
  archived: "default",
};

function statusText(item: ApprovalItem) {
  if (item.kind === "exception") {
    return EXCEPTION_STATUS_TEXT[item.status as keyof typeof EXCEPTION_STATUS_TEXT] || item.status;
  }
  if (item.kind === "report") {
    const map: Record<string, string> = {
      submitted: "待点评", pending_leader: "待审阅", archived: "已归档", draft: "草稿",
    };
    return map[item.status] || item.status;
  }
  return REQUEST_STATUS_TEXT[item.status as keyof typeof REQUEST_STATUS_TEXT] || item.status;
}

type TabKey = ApprovalTab | "report-rate";

type Pending = {
  item: ApprovalItem;
  action: "approve" | "reject" | "resolve" | "ignore" | "appeal";
  comment: string;
};

export const Approvals = () => {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  // 工作台待办会带 ?tab=pending 进来，直接定位到对应页签
  const [params] = useSearchParams();

  const [me, setMe] = useState<OaIdentity | null>(null);
  const [tab, setTab] = useState<TabKey>((params.get("tab") as TabKey) || "pending");
  const [list, setList] = useState<ApprovalItem[]>([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<Pending | null>(null);
  const [rateDate, setRateDate] = useState(dayjs());
  const [rate, setRate] = useState<SubmitRateResult | null>(null);
  const [rateLoading, setRateLoading] = useState(false);

  const handleError = useCallback((e: unknown, fallback: string) => {
    message.error(e instanceof Error ? e.message : fallback);
  }, [message]);

  useEffect(() => {
    void getMe().then(setMe).catch(() => {});
  }, []);

  const canManage = !!me?.can_view_team;

  const load = useCallback(async () => {
    if (tab === "report-rate") return;
    setLoading(true);
    try {
      const data = await getApprovalList({ tab: tab as ApprovalTab });
      setList(data.list || []);
      setPending(data.pending || 0);
    } catch (e) {
      handleError(e, "加载失败");
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [tab, handleError]);

  useEffect(() => { void load(); }, [load]);

  const loadRate = useCallback(async () => {
    setRateLoading(true);
    try {
      const data = await getSubmitRate({ date: rateDate.format("YYYY-MM-DD") });
      setRate(data);
    } catch (e) {
      handleError(e, "加载提交率失败");
      setRate(null);
    } finally {
      setRateLoading(false);
    }
  }, [rateDate, handleError]);

  useEffect(() => {
    if (tab === "report-rate") void loadRate();
  }, [tab, loadRate]);

  const doAction = useCallback(async () => {
    if (!action) return;
    const comment = action.comment.trim();
    if (!comment) {
      message.warning("请填写处理意见");
      return;
    }
    setBusy(true);
    try {
      const { item } = action;
      if (item.kind === "leave") {
        await approveLeave(item.id, action.action === "approve" ? "approve" : "reject", comment);
      } else if (item.kind === "makeup") {
        await approveMakeup(item.id, action.action === "approve" ? "approve" : "reject", comment);
      } else if (item.kind === "exception") {
        if (action.action === "appeal") {
          await appealException(item.id, comment);
        } else {
          await handleException(item.id, action.action === "resolve" ? "resolve" : "ignore", comment);
        }
      }
      message.success("已处理");
      setAction(null);
      void load();
    } catch (e) {
      handleError(e, "处理失败");
    } finally {
      setBusy(false);
    }
  }, [action, load, handleError, message]);

  const doScan = useCallback(async () => {
    try {
      const r = await scanExceptions(3);
      message.success(`扫描完成：新增 ${r.created} 条，已存在 ${r.skipped} 条`);
      void load();
    } catch (e) {
      handleError(e, "扫描失败");
    }
  }, [load, handleError, message]);

  const doUrge = useCallback(async () => {
    setBusy(true);
    try {
      const r = await urgeReports(rateDate.format("YYYY-MM-DD"));
      const suffix = r.pushed ? "（已同步 IM）" : "（仅站内信，未配置 IM 推送）";
      message.success(`已催交 ${r.urged} 人，跳过 ${r.skipped} 人 ${suffix}`);
      void loadRate();
    } catch (e) {
      handleError(e, "催交失败");
    } finally {
      setBusy(false);
    }
  }, [rateDate, loadRate, handleError, message]);

  const tabs = useMemo(() => {
    const base = [
      { label: pending > 0 ? `待我处理 (${pending})` : "待我处理", value: "pending" as TabKey },
      { label: "我发起的", value: "mine" as TabKey },
      { label: "已处理", value: "done" as TabKey },
    ];
    if (canManage) base.push({ label: "日报提交", value: "report-rate" });
    return base;
  }, [pending, canManage]);

  const columns: ColumnsType<ApprovalItem> = [
    {
      title: "类型", dataIndex: "kind_text", key: "kind", width: 88,
      render: (t: string, r) => (
        <Tag color={r.kind === "exception" ? "volcano" : r.kind === "report" ? "geekblue" : "blue"}>{t}</Tag>
      ),
    },
    {
      title: "申请人", key: "user", width: 140,
      render: (_, r) => (
        <div className={styles["ap-user"]}>
          <span>{r.user_name}</span>
          {r.department && <em>{r.department}</em>}
        </div>
      ),
    },
    {
      title: "内容", key: "content",
      render: (_, r) => (
        <div className={styles["ap-content"]}>
          <span>{r.title}</span>
          <em title={r.subtitle}>{r.subtitle}</em>
        </div>
      ),
    },
    {
      title: "时间", dataIndex: "time", key: "time", width: 118,
      render: (t: number) => <span className={styles["cell-mono"]}>{t ? dayjs(t).format("MM-DD HH:mm") : "—"}</span>,
    },
    {
      title: "状态", dataIndex: "status", key: "status", width: 88,
      render: (_: string, r) => <Tag color={STATUS_COLOR[r.status] || "default"}>{statusText(r)}</Tag>,
    },
    {
      title: "操作", key: "op", width: 168,
      render: (_, r) => {
        // 待我处理页只对"我能处理"的给按钮；其余给查看，避免点了报 403
        if (tab === "pending" && r.can_approve) {
          if (r.kind === "report") {
            return <a onClick={() => navigate(r.path)}>去审阅</a>;
          }
          if (r.kind === "exception") {
            return (
              <div className={styles["ap-op"]}>
                <a onClick={() => setAction({ item: r, action: "resolve", comment: "" })}>认定</a>
                <a onClick={() => setAction({ item: r, action: "ignore", comment: "" })}>忽略</a>
              </div>
            );
          }
          return (
            <div className={styles["ap-op"]}>
              <a onClick={() => setAction({ item: r, action: "approve", comment: "" })}>同意</a>
              <a onClick={() => setAction({ item: r, action: "reject", comment: "" })}>拒绝</a>
            </div>
          );
        }
        // 我发起的页：自己的异常还没处理时可以申诉（自己不能处理自己的）
        if (tab === "mine" && r.kind === "exception" && r.status === "open") {
          return (
            <div className={styles["ap-op"]}>
              <a onClick={() => setAction({ item: r, action: "appeal", comment: "" })}>申诉</a>
              <a onClick={() => navigate(r.path)}>查看</a>
            </div>
          );
        }
        return <a onClick={() => navigate(r.path)}>查看</a>;
      },
    },
  ];

  const actionTitle = () => {
    if (!action) return "";
    const { item, action: act } = action;
    if (act === "appeal") return "申诉考勤异常";
    if (item.kind === "exception") return act === "resolve" ? "认定这条异常" : "忽略这条异常";
    if (item.kind === "leave") return act === "approve" ? "通过请假申请" : "拒绝请假申请";
    return act === "approve" ? "通过补卡申请" : "拒绝补卡申请";
  };

  return (
    <div className={styles["ap-page"]}>
      <div className={styles["ap-topbar"]}>
        <div className={styles["ap-topbar-left"]}>
          <ArrowLeftOutlined onClick={() => navigate("/work")} />
          <span>审批中心</span>
        </div>
        <div className={styles["ap-topbar-right"]}>
          {canManage && (
            <Button size="small" icon={<ReloadOutlined />} onClick={() => void doScan()}>
              扫描考勤异常
            </Button>
          )}
          <Button size="small" onClick={() => void load()}>刷新</Button>
        </div>
      </div>

      <div className={styles["ap-subbar"]}>
        <Segmented
          className={styles["ap-segmented"]}
          value={tab}
          onChange={(v) => setTab(v as TabKey)}
          options={tabs}
        />
        <span className={styles["ap-hint"]}>
          {tab === "pending" && "待我处理：下属的请假、补卡、考勤异常，以及待点评/待审阅的日报"}
          {tab === "mine" && "我发起的申请与我的考勤异常"}
          {tab === "done" && "我已处理过的记录"}
          {tab === "report-rate" && "按部门统计当日日报提交情况，可一键催交未提交的人"}
        </span>
      </div>

      <div className={styles["ap-body"]}>
        <div className={styles["ap-inner"]}>
          {tab !== "report-rate" ? (
            <div className={styles["ap-card"]}>
              <Spin spinning={loading}>
                <Table
                  className={styles["ap-table"]}
                  rowKey={(r) => `${r.kind}-${r.id}`}
                  columns={columns}
                  dataSource={list}
                  pagination={list.length > 20 ? { pageSize: 20, size: "small" } : false}
                  locale={{ emptyText: tab === "pending" ? "暂无待处理事项" : "暂无记录" }}
                />
              </Spin>
            </div>
          ) : (
            <div className={styles["ap-card"]}>
              <div className={styles["ap-rate-head"]}>
                <DatePicker
                  value={rateDate}
                  allowClear={false}
                  onChange={(d) => d && setRateDate(d)}
                  size="small"
                />
                <Button size="small" icon={<ReloadOutlined />} onClick={() => void loadRate()}>刷新</Button>
                <Button
                  size="small"
                  type="primary"
                  icon={<SendOutlined />}
                  loading={busy}
                  onClick={() => void doUrge()}
                >
                  催交未提交
                </Button>
                {rate && (
                  <span className={styles["ap-rate-total"]}>
                    全范围 {rate.done}/{rate.total} 已交，提交率 <b>{rate.rate}%</b>
                  </span>
                )}
              </div>
              <Spin spinning={rateLoading}>
                <Table
                  className={styles["ap-table"]}
                  rowKey="department"
                  pagination={false}
                  dataSource={rate?.rows || []}
                  columns={[
                    { title: "部门", dataIndex: "department", key: "dept", width: 160 },
                    { title: "应提交", dataIndex: "total", key: "total", width: 90 },
                    { title: "已提交", dataIndex: "submitted", key: "submitted", width: 90 },
                    {
                      title: "提交率", dataIndex: "rate", key: "rate", width: 100,
                      render: (v: number) => <b style={{ color: v >= 80 ? "#1a9c5b" : "#d4380d" }}>{v}%</b>,
                    },
                    {
                      title: "未提交", dataIndex: "missing", key: "missing",
                      render: (v: string[]) =>
                        v?.length ? v.map((n) => <Tag key={n}>{n}</Tag>) : <span className={styles["ap-muted"]}>—</span>,
                    },
                  ]}
                />
              </Spin>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={!!action}
        title={actionTitle()}
        onCancel={() => setAction(null)}
        onOk={() => void doAction()}
        confirmLoading={busy}
        okText="确认"
        cancelText="取消"
        destroyOnClose
      >
        {action && (
          <>
            <div className={styles["approval-tip"]}>
              {action.item.user_name} · {action.item.title}
              <br />
              {action.item.subtitle}
            </div>
            <Input.TextArea
              rows={3}
              placeholder={action.action === "appeal" ? "请说明申诉理由（必填）" : "请填写处理意见（必填）"}
              value={action.comment}
              onChange={(e) => setAction({ ...action, comment: e.target.value })}
            />
          </>
        )}
      </Modal>
    </div>
  );
};
