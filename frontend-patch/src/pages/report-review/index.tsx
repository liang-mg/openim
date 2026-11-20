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
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  archiveReport,
  escalateReport,
  formatFileSize,
  fileIdOf,
  getAllReportsForReview,
  getFileLink,
  getMe,
  getReviewList,
  reportTypeText,
  submitReview,
  type OaIdentity,
  type ReportRecord,
} from "@/api/oaApi";

import styles from "./index.module.scss";

export const ReportReview = () => {
  const navigate = useNavigate();
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
  const [me, setMe] = useState<OaIdentity | null>(null);
  const [tab, setTab] = useState<"pending" | "archived">("pending");
  const [pendingList, setPendingList] = useState<ReportRecord[]>([]);
  const [archivedList, setArchivedList] = useState<ReportRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 身份决定视角：组长做「点评 + 上报」，领导做「点评 + 归档」
  const isManager = me?.role === "manager";
  const isLeader = me?.role === "leader" || me?.role === "hr" || me?.role === "admin";
  const canView = isManager || isLeader;

  const reload = async (identity: OaIdentity) => {
    if (identity.role === "manager") {
      const res = await getReviewList("manager");
      setPendingList(res.list);
      setArchivedList([]);
      return res.list;
    }
    const all = await getAllReportsForReview();
    setPendingList(all.filter((r) => r.status === "pending_leader"));
    setArchivedList(all.filter((r) => r.status === "archived"));
    return all;
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const identity = await getMe();
        setMe(identity);
        const ok = ["manager", "leader", "hr", "admin"].includes(identity.role);
        if (ok) {
          const all = await reload(identity);
          // 待查阅为空时直接落到「已归档」，避免领导进页面看到一片空白
          const hasPending = all.some((r) => r.status === "pending_leader");
          const initial = hasPending ? "pending" : "archived";
          setTab(initial);
          const pool = hasPending ? all.filter((r) => r.status === "pending_leader") : all.filter((r) => r.status === "archived");
          if (pool[0]) setSelectedId(pool[0].report_id);
        }
      } catch {
        message.error("加载失败，请稍后重试");
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const list = isManager ? pendingList : tab === "pending" ? pendingList : archivedList;
  const selected = list.find((r) => r.report_id === selectedId) || list[0];

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
    if (!selected) return;
    if (!comment.trim()) {
      message.warning("先写下点评内容");
      return;
    }
    setSubmitting(true);
    try {
      if (isManager) {
        await submitReview(selected.report_id, comment.trim(), "manager");
        await escalateReport(selected.report_id);
        message.success("点评已提交，并已上报领导");
      } else {
        await submitReview(selected.report_id, comment.trim(), "leader");
        await archiveReport(selected.report_id);
        message.success("点评已提交并归档");
      }
      const idx = list.findIndex((r) => r.report_id === selected.report_id);
      const next = list[idx + 1] || list[idx - 1];
      const all = me ? await reload(me) : [];
      setComment("");
      setSelectedId(next?.report_id || all[0]?.report_id);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "提交失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  const managerReview = selected?.reviews.find((r) => r.role === "manager");
  const leaderReview = selected?.reviews.find((r) => r.role === "leader");

  return (
    <div className={styles["review-page"]}>
      <div className={styles["review-topbar"]}>
        <div className={styles["topbar-left"]}>
          <ArrowLeftOutlined onClick={() => navigate("/work")} />
          <span>报告查阅</span>
          <span className={styles["badge"]}>{isManager ? "组长视角" : isLeader ? "领导视角" : "独立页面"}</span>
        </div>
        <div className={styles["topbar-user"]}>
          <span className={styles.avatar}>{(me?.real_name || "?").slice(0, 1)}</span>
          <span>{me?.real_name || "—"}</span>
        </div>
      </div>

      <Spin spinning={loading}>
        <div className={styles["review-body"]}>
          {!canView ? (
            <div className={styles["empty-detail"]}>报告查阅仅组长与领导可用</div>
          ) : (
            <>
              <aside className={styles["list-panel"]}>
                {isManager ? (
                  <div className={styles["tabs"]}>
                    <button className={styles.active}>待我查阅 {pendingList.length}</button>
                  </div>
                ) : (
                  <div className={styles.tabs}>
                    <button
                      className={clsx({ [styles.active]: tab === "pending" })}
                      onClick={() => switchTab("pending")}
                    >
                      待查阅 {pendingList.length}
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
                          {isManager ? "待点评" : r.status === "archived" ? "已归档" : "待查阅"}
                        </span>
                      </div>
                      <div className={styles["list-meta"]}>
                        {r.author.department} · {reportTypeText(r.type)} · 全文约 {wordCount(r)} 字
                      </div>
                    </div>
                  ))
                )}
              </aside>

              <div className={styles["detail-panel"]}>
                {!selected ? (
                  <div className={styles["empty-detail"]}>
                    {isManager ? "暂无待查阅日报" : "选择左侧报告开始查阅"}
                  </div>
                ) : (
                  <>
                    <div className={styles["detail-head-card"]}>
                      <div className={styles.avatar}>{selected.author.name.slice(0, 1)}</div>
                      <div className={styles["head-info"]}>
                        <div className={styles["head-name"]}>
                          {selected.author.name}
                          <span className={styles["head-dept"]}>{selected.author.department}</span>
                        </div>
                        <div className={styles["head-meta"]}>
                          {selected.period} {reportTypeText(selected.type)} · 提交于{" "}
                          {timeText(selected.submit_time)} · 全文约 {wordCount(selected)} 字
                        </div>
                      </div>
                      <span className={styles["head-status"]}>
                        {selected.status === "archived"
                          ? "已归档"
                          : selected.status === "pending_leader"
                            ? "待领导查阅"
                            : "待组长查阅"}
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
                        <div className={styles["card-title"]}>组长点评</div>
                        <div className={styles["review-quote"]}>
                          <div className={styles["quote-text"]}>{managerReview.comment}</div>
                          <div className={styles["quote-author"]}>
                            {managerReview.reviewer_name} · 组长 · {managerReview.review_time}
                          </div>
                        </div>
                      </div>
                    )}

                    {leaderReview && (
                      <div className={styles["card"]}>
                        <div className={styles["card-title"]}>领导点评</div>
                        <div className={styles["review-quote"]}>
                          <div className={styles["quote-text"]}>{leaderReview.comment}</div>
                          <div className={styles["quote-author"]}>
                            {leaderReview.reviewer_name} · 领导 · {leaderReview.review_time}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className={styles.card}>
                      <div className={styles["card-title"]}>附件 {selected.attachments.length}</div>
                      {selected.attachments.length === 0 ? (
                        <div className={styles["no-attachment"]}>无附件</div>
                      ) : (
                        selected.attachments.map((a, i) => (
                          <div key={i} className={styles["attachment-row"]}>
                            <span className={styles["file-icon"]}>
                              {["jpg", "jpeg", "png", "gif", "webp"].includes(a.file_type) ? (
                                <PictureOutlined />
                              ) : (
                                <FileTextOutlined />
                              )}
                            </span>
                            <span className={styles["file-name"]}>{a.name}</span>
                            <span className={styles["file-size"]}>{formatFileSize(a.size)}</span>
                            <span
                              className={styles.download}
                              onClick={() => openAttachment(a.url, a.name)}
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
                    ) : (
                      <div className={styles.card}>
                        <div className={styles["card-title"]}>我的点评</div>
                        <textarea
                          className={styles["comment-input"]}
                          placeholder={isManager ? "写下点评，确认后可上报领导…" : "写下你的点评…"}
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                        />
                        <div className={styles["comment-actions"]}>
                          <span className={styles["auto-tip"]}>
                            {isManager ? "上报后进入领导查阅" : "提交后自动打开下一条"}
                          </span>
                          <Button
                            type="primary"
                            className={styles["submit-btn"]}
                            loading={submitting}
                            onClick={doSubmit}
                          >
                            {isManager ? "点评并上报领导" : "提交点评并归档"}
                          </Button>
                        </div>
                      </div>
                    )}
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

function Section({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
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

function timeText(ts?: number) {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default ReportReview;
