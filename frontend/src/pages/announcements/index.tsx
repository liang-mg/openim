import { ArrowLeftOutlined } from "@ant-design/icons";
import { App, Button, Empty, Spin } from "antd";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { getAnnouncement, readAnnouncement, type Announcement } from "@/api/oaApi";
import notificationStyles from "@/pages/notifications/index.module.scss";

import styles from "./index.module.scss";

const formatTime = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function AnnouncementDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [detail, setDetail] = useState<Announcement>();
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    setProblem("");
    setDetail(undefined);
    void getAnnouncement(id)
      .then((announcement) => {
        if (!active) return;
        setDetail(announcement);
        void readAnnouncement(id).catch(() => {
          if (active) message.warning("阅读回执保存失败，请刷新后重试");
        });
      })
      .catch((error: unknown) => {
        if (active) setProblem(error instanceof Error ? error.message : "公告加载失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, message]);

  return (
    <main className={notificationStyles.page}>
      <header className={notificationStyles.header}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate("/notifications")}
        >
          返回通知
        </Button>
        <h1>公告</h1>
      </header>
      <div className={notificationStyles.content}>
        <Spin spinning={loading}>
          {detail && (
            <article className={styles.article}>
              <h2>{detail.title}</h2>
              <div className={styles.meta}>
                {detail.publisher_name} · {formatTime.format(detail.published_at)}
              </div>
              <p>{detail.content}</p>
            </article>
          )}
          {!loading && !detail && <Empty description={problem || "公告无法查看"} />}
        </Spin>
      </div>
    </main>
  );
}
