import {
  DownOutlined,
  EditOutlined,
  LogoutOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { App as AntdApp, Card, List } from "antd";
import clsx from "clsx";

import OIMAvatar from "@/components/OIMAvatar";
import { APP_NAME, APP_VERSION } from "@/config";
import { useUserStore } from "@/store";

import styles from "./index.module.scss";

export const Mine = () => {
  const { modal } = AntdApp.useApp();
  const selfInfo = useUserStore((state) => state.selfInfo);

  return (
    <div className={clsx(styles["mine-page"], "mobile-bottom-space")}>
      <div className="mobile-top-bar">
        <span>{APP_NAME} · 我</span>
      </div>

      <div className={styles["mine-scroll"]}>
        <Card className={styles["profile-card"]} bordered={false}>
          <div className={styles["profile-row"]}>
            <OIMAvatar
              src={selfInfo.faceURL}
              text={selfInfo.nickname}
              size={56}
            />
            <div className={styles["profile-info"]}>
              <div className={styles["profile-name"]}>
                {selfInfo.nickname || "未设置昵称"}
              </div>
              <div className={styles["profile-id"]}>
                账号：{selfInfo.userID || "-"}
              </div>
            </div>
            <EditOutlined
              className={styles["profile-edit"]}
              onClick={() => modal.info({ title: "编辑资料", content: "功能开发中" })}
            />
          </div>
        </Card>

        <Card className={styles["mine-section"]} bordered={false}>
          <List
            dataSource={[
              { icon: <SettingOutlined />, label: "设置", action: "设置" },
              { icon: <LogoutOutlined />, label: "退出登录", action: "退出" },
            ]}
            renderItem={(item) => (
              <List.Item
                className={styles["mine-list-item"]}
                onClick={() =>
                  modal.info({ title: item.action, content: "功能开发中" })
                }
              >
                <span className={styles["mine-list-icon"]}>{item.icon}</span>
                <span className={styles["mine-list-label"]}>{item.label}</span>
                <DownOutlined className={styles["mine-list-arrow"]} />
              </List.Item>
            )}
          />
        </Card>

        <div className={styles["mine-version"]}>
          {APP_NAME} {APP_VERSION}
        </div>
      </div>
    </div>
  );
};

export default Mine;
