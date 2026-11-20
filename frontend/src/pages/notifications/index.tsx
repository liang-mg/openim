import { ArrowLeftOutlined, ReloadOutlined } from "@ant-design/icons";
import { App, Button, Empty, Segmented, Spin, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getNotifications, readNotifications, type OaNotification } from "@/api/oaApi";

import styles from "./index.module.scss";

const pushLabels = {
  pending: "IM 发送中",
  succeeded: "IM 请求成功",
  failed: "IM 发送失败",
  not_configured: "未配置 IM",
};

const formatTime = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

export const Notifications = () => {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [tab, setTab] = useState("all");
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState<string>();
  const [notifications, setNotifications] = useState<OaNotification[]>([]);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getNotifications(tab === "all");
      setNotifications(response.list);
      setUnread(response.unread);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "通知加载失败");
    } finally {
      setLoading(false);
    }
  }, [message, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = async (id?: string) => {
    setMarking(id ?? "all");
    try {
      await readNotifications(id);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "标记已读失败");
    } finally {
      setMarking(undefined);
    }
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate("/work")}
        >
          工作台
        </Button>
        <h1>通知</h1>
      </header>
      <section className={styles.content} aria-label="通知列表">
        <div className={styles.actions}>
          <Segmented
            options={[
              { label: "全部", value: "all" },
              { label: `未读 (${unread})`, value: "unread" },
            ]}
            value={tab}
            onChange={(value) => setTab(String(value))}
          />
          <div className={styles.buttons}>
            <Button icon={<ReloadOutlined />} onClick={() => void load()}>
              刷新
            </Button>
            <Button
              disabled={unread === 0 || Boolean(marking)}
              loading={marking === "all"}
              onClick={() => void markRead()}
            >
              全部标为已读
            </Button>
          </div>
        </div>
        <Spin spinning={loading}>
          {notifications.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无通知" />
          ) : (
            <ul className={styles.list}>
              {notifications.map((notice) => (
                <li className={styles.notice} key={notice.notification_id}>
                  <article>
                    <div className={styles.caption}>
                      <h2>{notice.title}</h2>
                      {!notice.read && <Tag color="blue">未读</Tag>}
                    </div>
                    <time dateTime={new Date(notice.created_at).toISOString()}>
                      {formatTime.format(notice.created_at)}
                    </time>
                    <p>{notice.content}</p>
                    {notice.im_status && <span>{pushLabels[notice.im_status]}</span>}
                  </article>
                  <div className={styles.buttons}>
                    {!notice.read && (
                      <Button
                        disabled={Boolean(marking)}
                        loading={marking === notice.notification_id}
                        onClick={() => void markRead(notice.notification_id)}
                      >
                        标为已读
                      </Button>
                    )}
                    {/^[\/](?![\/\\])/.test(notice.path) && (
                      <Button type="link" onClick={() => navigate(notice.path)}>
                        查看记录
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Spin>
      </section>
    </main>
  );
};
