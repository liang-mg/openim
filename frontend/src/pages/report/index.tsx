import {
  ArrowLeftOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  CopyOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  FireFilled,
  InboxOutlined,
  PaperClipOutlined,
  RollbackOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { App as AntdApp, Button, Spin } from "antd";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  formatFileSize,
  getFileLink,
  getReportOverview,
  fileIdOf,
  reportTypeText,
  submitReport,
  uploadFile,
  withdrawReport,
  type ReportAttachment,
  type ReportContent,
  type ReportOverview,
  type ReportStatus,
} from "@/api/oaApi";
import { useUserStore } from "@/store";

import styles from "./index.module.scss";

const MAX_LEN = 800;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED_EXT = ["jpg", "jpeg", "png", "gif", "webp", "pdf", "doc", "docx", "xls", "xlsx", "txt", "zip"];

const statusMeta: Record<ReportStatus, { text: string; cls: string }> = {
  draft: { text: "草稿", cls: "draft" },
  submitted: { text: "待查阅", cls: "submitted" },
  pending_leader: { text: "待终审", cls: "pending" },
  archived: { text: "已归档", cls: "archived" },
};

interface LocalAttachment extends ReportAttachment {
  uid: string;
  /** 本地预览地址，仅用于上传中的缩略图 */
  objectUrl?: string;
  /** 服务端签名地址，用于图片预览 */
  signedUrl?: string;
  /** 还在上传：此时不允许提交 */
  uploading?: boolean;
}

function dateStr(offsetDays: number) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

const emptyContent: ReportContent = { done: "", plan: "", issues: "" };

export const Report = () => {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const selfInfo = useUserStore((state) => state.selfInfo);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [overview, setOverview] = useState<ReportOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [periodOffset, setPeriodOffset] = useState(0);
  const [content, setContent] = useState<ReportContent>(emptyContent);
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [dragging, setDragging] = useState(false);

  const period = dateStr(periodOffset);

  // 当天/昨天是否已有报告：已有则回填内容，并按状态锁定表单，避免重复提交或覆盖已归档内容
  const current = overview?.recent.find((r) => r.period === period);
  const locked = !!current && current.status !== "draft";
  const loadedPeriodRef = useRef<string | null>(null);

  const refresh = async () => {
    const data = await getReportOverview();
    setOverview(data);
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await refresh();
      setLoading(false);
    })();
    return () => {
      // 组件卸载时释放本地预览 url
    };
  }, []);

  // 切换日期或首次加载时，把该日期已有的报告回填到编辑器
  useEffect(() => {
    if (!overview) return;
    if (loadedPeriodRef.current === period) return;
    loadedPeriodRef.current = period;
    const rec = overview.recent.find((r) => r.period === period);
    if (rec) {
      setContent(rec.content);
      setAttachments(
        rec.attachments.map((a, i) => ({ ...a, uid: `${rec.report_id}_${i}` })),
      );
    } else {
      setContent(emptyContent);
      setAttachments([]);
    }
  }, [overview, period]);

  // 回填的历史附件只有 file_id，图片缩略图要换签名地址（<img> 带不了 token 头）
  useEffect(() => {
    const pending = attachments.filter(
      (a) =>
        !a.uploading &&
        !a.signedUrl &&
        a.url &&
        ["jpg", "jpeg", "png", "gif", "webp"].includes(a.file_type),
    );
    if (!pending.length) return;
    let alive = true;
    (async () => {
      const links = await Promise.all(
        pending.map(async (a) => {
          const id = fileIdOf(a.url);
          if (!id) return null;
          try {
            const link = await getFileLink(id);
            return { uid: a.uid, signedUrl: link.signed_url };
          } catch {
            return null;
          }
        }),
      );
      if (!alive) return;
      setAttachments((prev) =>
        prev.map((a) => {
          const hit = links.find((x) => x && x.uid === a.uid);
          return hit ? { ...a, signedUrl: hit.signedUrl } : a;
        }),
      );
    })();
    return () => {
      alive = false;
    };
  }, [attachments]);

  const setField = (key: keyof ReportContent, value: string) => {
    setContent((prev) => ({ ...prev, [key]: value.slice(0, MAX_LEN) }));
  };

  const addFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    let rejected = 0;
    const accepted: LocalAttachment[] = [];
    const toUpload: { uid: string; file: File }[] = [];
    for (const file of list) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      if (file.size > MAX_FILE_SIZE || !ALLOWED_EXT.includes(ext)) {
        rejected += 1;
        continue;
      }
      const uid = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      // 先用本地预览顶住，上传完成后换成服务端地址
      accepted.push({
        uid,
        name: file.name,
        size: file.size,
        file_type: ext,
        url: "",
        objectUrl: URL.createObjectURL(file),
        uploading: true,
      });
      toUpload.push({ uid, file });
    }
    if (accepted.length) {
      setAttachments((prev) => [...prev, ...accepted]);
    }
    if (rejected) {
      message.warning(`${rejected} 个文件不符合要求（≤20MB，常见文档/图片格式）`);
    }

    // 真正上传：拿到 file_id 后再允许提交，避免把临时地址存进日报
    toUpload.forEach(async ({ uid, file }) => {
      try {
        const res = await uploadFile(file, "report");
        setAttachments((prev) =>
          prev.map((a) =>
            a.uid === uid
              ? { ...a, url: res.url, signedUrl: res.signed_url, uploading: false }
              : a,
          ),
        );
      } catch (e) {
        setAttachments((prev) => prev.filter((a) => a.uid !== uid));
        message.error(`「${file.name}」上传失败，请重试`);
      }
    });
  };

  const removeAttachment = (uid: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.uid === uid);
      if (target?.objectUrl) URL.revokeObjectURL(target.objectUrl);
      return prev.filter((a) => a.uid !== uid);
    });
  };

  const copyYesterday = () => {
    const yesterday = dateStr(1);
    const found = overview?.recent.find((r) => r.period === yesterday);
    if (!found) {
      message.info("昨天没有可复制的日报");
      return;
    }
    setPeriodOffset(1);
    setContent({
      done: found.content.done,
      plan: found.content.plan,
      issues: found.content.issues,
    });
    message.success("已带入昨天的日报内容，可在此基础上修改");
  };

  const doWithdraw = async (reportId: string) => {
    try {
      await withdrawReport(reportId);
      message.success("已撤回为草稿，可修改后重新提交");
      await refresh();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "撤回失败");
    }
  };

  const doSubmit = async (status: "draft" | "submitted") => {
    if (locked) {
      message.info("该日报已提交，当前不可修改");
      return;
    }
    if (status === "submitted" && !content.done.trim()) {
      message.warning("先写下今天完成的工作再提交");
      return;
    }
    if (attachments.some((a) => a.uploading)) {
      message.warning("附件还在上传，请稍候再提交");
      return;
    }
    setSubmitting(true);
    try {
      await submitReport({
        type: "daily",
        period,
        content,
        status,
        attachments: attachments.map(({ name, size, file_type, url }) => ({
          name,
          size,
          file_type,
          url,
        })),
      });
      message.success(
        status === "draft" ? "草稿已保存" : periodOffset === 0 ? "日报提交成功" : "补写的日报已提交",
      );
      attachments.forEach((a) => a.objectUrl && URL.revokeObjectURL(a.objectUrl));
      setContent(emptyContent);
      setAttachments([]);
      setPeriodOffset(0);
      // 重新从概览回填该日期的最新记录，让状态条与正文保持同步
      loadedPeriodRef.current = null;
      await refresh();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  const totalDone = content.done.length + content.plan.length + content.issues.length;
  // 概览接口只返回当前登录人自己的日报，无需再比对作者
  const canWithdraw = (r: { submit_time?: number; status: ReportStatus }) =>
    r.status === "submitted" &&
    r.submit_time != null &&
    Date.now() - r.submit_time <= 2 * 60 * 60 * 1000;

  return (
    <div className={styles["report-page"]}>
      <div className={styles["report-topbar"]}>
        <div className={styles["topbar-left"]}>
          <ArrowLeftOutlined onClick={() => navigate("/work")} />
          <span>工作报告</span>
        </div>
        <span className={styles["topbar-user"]}>{selfInfo.nickname || "同事"}</span>
      </div>

      <Spin spinning={loading}>
        <div className={styles["report-body"]}>
          <div className={styles["editor-column"]}>
            <div className={styles["editor-card"]}>
              <div className={styles["editor-head"]}>
                <div className={styles["editor-head-left"]}>
                  <span className={styles["editor-title"]}>写日报</span>
                  <button className={styles["copy-btn"]} onClick={copyYesterday}>
                    <CopyOutlined /> 复制昨天
                  </button>
                </div>
                <div className={styles["period-switch"]}>
                  <button
                    className={clsx({ [styles.active]: periodOffset === 0 })}
                    onClick={() => setPeriodOffset(0)}
                  >
                    今天
                  </button>
                  <button
                    className={clsx({ [styles.active]: periodOffset === 1 })}
                    onClick={() => setPeriodOffset(1)}
                  >
                    昨天
                  </button>
                  <span className={styles.period}>{period}</span>
                </div>
              </div>

              {current && current.status !== "draft" && (
                <div
                  className={clsx(styles["locked-bar"], {
                    [styles.pending]: current.status === "pending_leader",
                    [styles.archived]: current.status === "archived",
                  })}
                >
                  <span className={styles["locked-dot"]} />
                  <span>
                    {current.status === "submitted" &&
                      "日报已提交，等待直属上级点评。提交后 2 小时内可在右侧撤回修改。"}
                    {current.status === "pending_leader" &&
                      "直属上级已点评并上报，正在等待终审。"}
                    {current.status === "archived" && "日报已归档，内容已锁定。"}
                  </span>
                </div>
              )}

              <div className={styles["field-list"]}>
                <Field
                  icon={<CheckCircleOutlined />}
                  label="今日完成"
                  value={content.done}
                  onChange={(v) => setField("done", v)}
                  placeholder="写下今天完成的工作，一条一行…"
                  required
                  readOnly={locked}
                />
                <Field
                  icon={<CalendarOutlined />}
                  label="明日计划"
                  value={content.plan}
                  onChange={(v) => setField("plan", v)}
                  placeholder="明天准备推进的事项…"
                  readOnly={locked}
                />
                <Field
                  icon={<ExclamationCircleOutlined />}
                  label="遇到问题"
                  value={content.issues}
                  onChange={(v) => setField("issues", v)}
                  placeholder="需要协助或待确认的问题，没有可留空…"
                  optional
                  readOnly={locked}
                />
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ALLOWED_EXT.map((e) => `.${e}`).join(",")}
                hidden
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <div
                className={clsx(styles.attachment, {
                  [styles.dragging]: dragging,
                  [styles["attachment-locked"]]: locked,
                })}
                onClick={() => !locked && fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!locked) setDragging(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setDragging(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (!locked && e.dataTransfer.files) addFiles(e.dataTransfer.files);
                }}
              >
                <InboxOutlined />
                <span>
                  {locked ? "日报已提交，附件不可再增删" : "点击或拖拽添加附件 · 单个文件 ≤ 20MB"}
                </span>
              </div>

              {attachments.length > 0 && (
                <div className={styles["attachment-list"]}>
                  {attachments.map((a) => {
                    const isImage = ["jpg", "jpeg", "png", "gif", "webp"].includes(a.file_type);
                    return (
                      <div key={a.uid} className={styles["attachment-item"]}>
                        <div className={styles["attachment-thumb"]}>
                          {a.uploading && !a.objectUrl ? (
                            <span className={styles["attachment-uploading"]}>上传中</span>
                          ) : isImage ? (
                            <img src={a.signedUrl || a.objectUrl} alt="" />
                          ) : (
                            <FileTextOutlined />
                          )}
                        </div>
                        <span className={styles["attachment-name"]}>{a.name}</span>
                        <span className={styles["attachment-size"]}>{formatFileSize(a.size)}</span>
                        {!locked && (
                          <DeleteOutlined
                            className={styles["attachment-remove"]}
                            onClick={(e) => {
                              e.stopPropagation();
                              removeAttachment(a.uid);
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className={styles["submit-row"]}>
                <Button
                  icon={<SaveOutlined />}
                  loading={submitting}
                  disabled={locked}
                  onClick={() => doSubmit("draft")}
                >
                  存草稿
                </Button>
                <Button
                  type="primary"
                  icon={<CheckOutlined />}
                  className={styles["primary-btn"]}
                  loading={submitting}
                  disabled={locked || totalDone === 0}
                  onClick={() => doSubmit("submitted")}
                >
                  {locked
                    ? current?.status === "archived"
                      ? "已归档"
                      : "已提交"
                    : "提交报告"}
                </Button>
              </div>
            </div>
          </div>

          <div className={styles["status-column"]}>
            <div className={styles["side-card"]}>
              <div className={styles["side-card-head"]}>
                <span className={styles["side-title"]}>本周提交</span>
                <span className={styles["week-count"]}>
                  {overview?.week_submitted ?? 0} / {overview?.week_required ?? 5} 天
                </span>
              </div>
              <div className={styles["progress-track"]}>
                <div
                  className={styles["progress-fill"]}
                  style={{
                    width: `${((overview?.week_submitted ?? 0) / (overview?.week_required ?? 5)) * 100}%`,
                  }}
                />
              </div>
              <div className={styles.streak}>
                <FireFilled />
                <span>连续 {overview?.streak_days ?? 0} 天 · 保持住</span>
              </div>
            </div>

            <div className={styles["side-card"]}>
              <div className={styles["side-title"]}>最近报告</div>
              <div className={styles["recent-list"]}>
                {overview?.recent.map((r) => {
                  const meta = statusMeta[r.status];
                  return (
                    <div key={r.report_id} className={styles["recent-row"]}>
                      <span className={styles["recent-name"]}>
                        {r.period.slice(5)} {reportTypeText(r.type)}
                      </span>
                      <div className={styles["recent-actions"]}>
                        {canWithdraw(r) && (
                          <button
                            className={styles["withdraw-btn"]}
                            onClick={() => doWithdraw(r.report_id)}
                            title="提交后 2 小时内可撤回"
                          >
                            <RollbackOutlined /> 撤回
                          </button>
                        )}
                        <span className={clsx(styles["status-tag"], styles[meta.cls])}>
                          {meta.text}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {overview?.latest_review && (
              <div className={styles["side-card"]}>
                <div className={styles["side-title"]}>上级点评</div>
                <div className={styles["review-quote"]}>
                  <div className={styles["review-text"]}>{overview.latest_review.comment}</div>
                  <div className={styles["review-author"]}>
                    —— {overview.latest_review.reviewer_name} · {overview.latest_review.review_time}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </Spin>
    </div>
  );
};

function Field({
  icon,
  label,
  value,
  onChange,
  placeholder,
  required,
  optional,
  readOnly,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  required?: boolean;
  optional?: boolean;
  readOnly?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className={styles.field}>
      <div className={styles["field-head"]}>
        <div className={styles["field-label"]}>
          <span className={styles["field-icon"]}>{icon}</span>
          <span>{label}</span>
          {readOnly ? (
            <span className={styles.locked}>只读</span>
          ) : focused ? (
            <span className={styles.typing}>正在输入</span>
          ) : optional ? (
            <span className={styles.optional}>选填</span>
          ) : required && !value ? (
            <span className={styles.required}>必填</span>
          ) : null}
        </div>
        <span className={styles.counter}>
          {value.length} / {MAX_LEN}
        </span>
      </div>
      <div
        className={clsx(styles["input-box"], {
          [styles.focused]: focused && !readOnly,
          [styles.readonly]: readOnly,
        })}
      >
        <textarea
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={readOnly ? "暂无内容" : placeholder}
        />
      </div>
      <div className={styles["field-progress"]}>
        <div
          className={styles["field-progress-fill"]}
          style={{ width: `${(value.length / MAX_LEN) * 100}%` }}
        />
      </div>
    </div>
  );
}

export default Report;
