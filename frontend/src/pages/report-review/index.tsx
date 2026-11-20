import {
  ArrowLeftOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  DownloadOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  PictureOutlined,
} from "@ant-design/icons";
import { App as AntdApp, Button, Empty, Spin } from "antd";
import clsx from "clsx";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  fileIdOf,
  formatFileSize,
  getAllReportsForReview,
  getFileLink,
  getMe,
  type OaIdentity,
  type ReportRecord,
  reportTypeText,
  submitReview,
} from "@/api/oaApi";

import styles from "./index.module.scss";

export const ReportReview = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetId = searchParams.get("report_id") || undefined;
  const { message } = AntdApp.useApp();

  // 附件在 MinIO 里，直链需要 token；<a href> 带不了 header，
  // 所以点下载时先向后端换一个 30 分钟有效的签名地址再打开。
  const openAttachment = async (url: string, name: string) => {
    const id = fileIdOf(url);
    if (!id) {
      message.error("附件地址无效");
      return;
    }
    try {
      const link = await getFileLink(id);
      const a = document.createElement("a");
      a.href = link.signed_url;
      a.download = name;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "下载失败");
    }
  };

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [me, setMe] = useState<OaIdentity | null>(null);
  const [tab, setTab] = useState<"pending" | "archived">("pending");
  const [pendingList, setPendingList] = useState<ReportRecord[]>([]);
  const [archivedList, setArchivedList] = useState<ReportRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const showReports = useCallback((reports: ReportRecord[]) => {
    const pending = reports.filter((r) => r.status !== "archived");
    const archived = reports.filter((r) => r.status === "archived");
    setPendingList(pending);
    setArchivedList(archived);
    setTab(pending.length || !archived.length ? "pending" : "archived");
    setSelectedId((id) =>
      pending.some((r) => r.report_id === id)
        ? id
        : (pending[0] || archived[0])?.report_id,
    );
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setLoadError(false);
      showReports([]);
      setComment("");
      try {
        const [identity, reports] = await Promise.all([
          getMe(),
          getAllReportsForReview(targetId),
        ]);
        if (!active) return;
        setMe(identity);
        showReports(reports);
      } catch {
        if (active) setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [showReports, targetId]);

  const list = tab === "pending" ? pendingList : archivedList;
  const selected = list.find((r) => r.report_id === selectedId) || list[0];
  const actions = selected?.review_actions;
  const actionLabel = actions?.can_escalate
    ? "点评并上报"
    : actions?.can_archive
    ? "提交点评并归档"
    : "保存点评";

  const switchTab = (t: "pending" | "archived") => {
    setTab(t);
    const next = t === "pending" ? pendingList : archivedList;
    setSelectedId(next[0]?.report_id);
    setComment("");
  };

  const switchReport = (id: string) => {
    setSelectedId(id);
    setComment("");
  };

  const doSubmit = async () => {
    if (!selected || !actions?.can_comment) return;
    if (!comment.trim()) {
      message.warning("先写下点评内容");
      return;
    }
    setSubmitting(true);
    try {
      await submitReview(
        selected.report_id,
        comment.trim(),
        selected.status === "pending_leader" ? "leader" : "manager",
        actions.can_escalate || actions.can_archive,
      );
      setComment("");
      message.success(
        actions.can_escalate
          ? "点评已提交，已上报终审"
          : actions.can_archive
          ? "点评已提交并归档"
          : "点评已保存",
      );
    } catch (e) {
      message.error(e instanceof Error ? e.message : "提交失败，请重试");
      setSubmitting(false);
      return;
    }
    try {
      showReports(await getAllReportsForReview(targetId));
    } catch {
      showReports([]);
      setLoadError(true);
    } finally {
      setSubmitting(false);
    }
  };

  const managerReview = selected?.reviews
    .filter((r) => r.role === "manager")
    .slice(-1)[0];
  const leaderReview = selected?.reviews
    .filter((r) => r.role === "leader")
    .slice(-1)[0];

  return (
    <div className={styles["review-page"]}>
      <div className={styles["review-topbar"]}>
        <div className={styles["topbar-left"]}>
          <ArrowLeftOutlined onClick={() => navigate("/work")} />
          <span>报告查阅</span>
        </div>
        <div className={styles["topbar-user"]}>
          <span className={styles.avatar}>{(me?.real_name || "?").slice(0, 1)}</span>
          <span>{me?.real_name || "—"}</span>
        </div>
      </div>

      <Spin spinning={loading}>
        <div className={styles["review-body"]}>
          {loadError ? (
            <div className={styles["empty-detail"]}>
              {targetId
                ? "无法打开该日报，请确认查阅权限后重试"
                : "加载失败，请稍后重试"}
            </div>
          ) : (
            <>
              <aside className={styles["list-panel"]}>
                {!targetId && (
                  <div className={styles.tabs}>
                    <button
                      className={clsx({ [styles.active]: tab === "pending" })}
                      onClick={() => switchTab("pending")}
                    >
                      待我查阅 {pendingList.length}
                    </button>
                    <button
                      className={clsx({ [styles.active]: tab === "archived" })}
                      onClick={() => switchTab("archived")}
                    >
                      已归档
                    </button>
                  </div>
                )}
                {list.length === 0 ? (
                  <Empty description="暂无报告" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  list.map((r) => (
                    <div
                      key={r.report_id}
                      className={clsx(styles["list-item"], {
                        [styles.selected]: selected?.report_id === r.report_id,
                      })}
                      onClick={() => switchReport(r.report_id)}
                    >
                      <div className={styles["list-row"]}>
                        <span className={styles["list-name"]}>{r.author.name}</span>
                        <span
                          className={clsx(styles["list-status"], {
                            [styles.done]: r.status === "archived",
                          })}
                        >
                          {reviewStatusText(r.status)}
                        </span>
                      </div>
                      <div className={styles["list-meta"]}>
                        {r.author.department} · {reportTypeText(r.type)} · 全文约{" "}
                        {wordCount(r)} 字
                      </div>
                    </div>
                  ))
                )}
              </aside>

              <div className={styles["detail-panel"]}>
                {!selected ? (
                  <div className={styles["empty-detail"]}>
                    {tab === "pending" ? "暂无待查阅日报" : "暂无已归档日报"}
                  </div>
                ) : (
                  <>
                    <div className={styles["detail-head-card"]}>
                      <div className={styles.avatar}>
                        {selected.author.name.slice(0, 1)}
                      </div>
                      <div className={styles["head-info"]}>
                        <div className={styles["head-name"]}>
                          {selected.author.name}
                          <span className={styles["head-dept"]}>
                            {selected.author.department}
                          </span>
                        </div>
                        <div className={styles["head-meta"]}>
                          {selected.period} {reportTypeText(selected.type)} · 提交于{" "}
                          {timeText(selected.submit_time)} · 全文约{" "}
                          {wordCount(selected)} 字
                        </div>
                      </div>
                      <span className={styles["head-status"]}>
                        {reviewStatusText(selected.status)}
                      </span>
                    </div>

                    <div className={styles["content-card"]}>
                      <div className={styles["content-inner"]}>
                        <Section
                          icon={<CheckCircleOutlined />}
                          title="今日完成"
                          text={selected.content?.done}
                        />
                        <Section
                          icon={<CalendarOutlined />}
                          title="明日计划"
                          text={selected.content?.plan}
                        />
                        <Section
                          icon={<ExclamationCircleOutlined />}
                          title="遇到问题"
                          text={selected.content?.issues}
                        />
                      </div>
                    </div>

                    {managerReview && (
                      <div className={styles["card"]}>
                        <div className={styles["card-title"]}>直属上级点评</div>
                        <div className={styles["review-quote"]}>
                          <div className={styles["quote-text"]}>
                            {managerReview.comment}
                          </div>
                          <div className={styles["quote-author"]}>
                            {managerReview.reviewer_name} · {managerReview.review_time}
                          </div>
                        </div>
                      </div>
                    )}

                    {leaderReview && (
                      <div className={styles["card"]}>
                        <div className={styles["card-title"]}>终审点评</div>
                        <div className={styles["review-quote"]}>
                          <div className={styles["quote-text"]}>
                            {leaderReview.comment}
                          </div>
                          <div className={styles["quote-author"]}>
                            {leaderReview.reviewer_name} · {leaderReview.review_time}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className={styles.card}>
                      <div className={styles["card-title"]}>
                        附件 {selected.attachments.length}
                      </div>
                      {selected.attachments.length === 0 ? (
                        <div className={styles["no-attachment"]}>无附件</div>
                      ) : (
                        selected.attachments.map((a, i) => (
                          <div key={i} className={styles["attachment-row"]}>
                            <span className={styles["file-icon"]}>
                              {["jpg", "jpeg", "png", "gif", "webp"].includes(
                                a.file_type,
                              ) ? (
                                <PictureOutlined />
                              ) : (
                                <FileTextOutlined />
                              )}
                            </span>
                            <span className={styles["file-name"]}>{a.name}</span>
                            <span className={styles["file-size"]}>
                              {formatFileSize(a.size)}
                            </span>
                            <span
                              className={styles.download}
                              onClick={() => void openAttachment(a.url, a.name)}
                            >
                              <DownloadOutlined /> 下载
                            </span>
                          </div>
                        ))
                      )}
                    </div>

                    {selected.status === "archived" ? (
                      <div className={styles["archived-bar"]}>
                        <CheckCircleOutlined />
                        <span>
                          该日报已归档，审阅流程结束，内容与点评均不可再修改。
                        </span>
                      </div>
                    ) : actions?.can_comment ? (
                      <div className={styles.card}>
                        <div className={styles["card-title"]}>我的点评</div>
                        <textarea
                          className={styles["comment-input"]}
                          placeholder="写下你的点评…"
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                        />
                        <div className={styles["comment-actions"]}>
                          <span className={styles["auto-tip"]}>
                            {actions.can_escalate
                              ? "上报后进入终审"
                              : actions.can_archive
                              ? "确认后结束审阅流程"
                              : "尚未配置终审人"}
                          </span>
                          <Button
                            type="primary"
                            className={styles["submit-btn"]}
                            loading={submitting}
                            onClick={() => void doSubmit()}
                          >
                            {actionLabel}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </Spin>
    </div>
  );
};

function Section({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className={styles.section}>
      <div className={styles["section-title"]}>
        <span className={styles["section-icon"]}>{icon}</span>
        {title}
      </div>
      <div className={styles["section-text"]}>{text || "—"}</div>
    </div>
  );
}

function wordCount(r: ReportRecord) {
  // 历史数据可能缺字段，避免 undefined.length 直接抛错
  const c = r.content || { done: "", plan: "", issues: "" };
  return (c.done || "").length + (c.plan || "").length + (c.issues || "").length;
}

function reviewStatusText(status: ReportRecord["status"]) {
  switch (status) {
    case "draft":
      return "草稿";
    case "submitted":
      return "待直属上级点评";
    case "pending_leader":
      return "待终审";
    case "archived":
      return "已归档";
  }
}

function timeText(ts?: number) {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(
    2,
    "0",
  )}`;
}

export default ReportReview;
