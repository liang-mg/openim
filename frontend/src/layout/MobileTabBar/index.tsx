import { Badge } from "antd";
import clsx from "clsx";
import { t } from "i18next";
import { useLocation, useNavigate } from "react-router-dom";

import contact_icon from "@/assets/images/nav/nav_bar_contact.png";
import contact_icon_active from "@/assets/images/nav/nav_bar_contact_active.png";
import message_icon from "@/assets/images/nav/nav_bar_message.png";
import message_icon_active from "@/assets/images/nav/nav_bar_message_active.png";
import workbench_icon from "@/assets/images/nav/nav_bar_workbench.png";
import workbench_icon_active from "@/assets/images/nav/nav_bar_workbench_active.png";
import OIMAvatar from "@/components/OIMAvatar";
import { useContactStore, useUserStore } from "@/store";

type TabKey = "chat" | "contact" | "work" | "mine";

const TABS: {
  key: TabKey;
  label: string;
  path: string;
  icon: string;
  activeIcon: string;
}[] = [
  {
    key: "chat",
    label: t("placeholder.chat"),
    path: "/chat",
    icon: message_icon,
    activeIcon: message_icon_active,
  },
  {
    key: "contact",
    label: t("placeholder.contact"),
    path: "/contact",
    icon: contact_icon,
    activeIcon: contact_icon_active,
  },
  {
    key: "work",
    label: "工作",
    path: "/work",
    icon: workbench_icon,
    activeIcon: workbench_icon_active,
  },
  {
    key: "mine",
    label: "我",
    path: "/mine",
    icon: "",
    activeIcon: "",
  },
];

const MobileTabBar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const selfInfo = useUserStore((state) => state.selfInfo);
  const unreadFriend = useContactStore(
    (state) => state.unHandleFriendApplicationCount,
  );
  const unreadGroup = useContactStore(
    (state) => state.unHandleGroupApplicationCount,
  );

  const activeKey: TabKey = location.pathname.startsWith("/work")
    ? "work"
    : location.pathname.startsWith("/mine")
      ? "mine"
      : location.pathname.startsWith("/contact")
        ? "contact"
        : "chat";

  // 进入聊天/联系人详情页时隐藏底部导航，把空间让给内容（与微信一致）
  const inDetail =
    /^\/chat\/[^/]+/.test(location.pathname) ||
    /^\/contact\/[^/]+/.test(location.pathname) ||
    location.pathname === "/contact/newFriends" ||
    location.pathname === "/contact/groupNotifications" ||
    location.pathname === "/contact/myGroups";
  if (inDetail) return null;

  return (
    <nav className="mobile-tab-bar">
      {TABS.map((tab) => {
        const active = tab.key === activeKey;
        const badgeCount =
          tab.key === "contact" ? unreadFriend + unreadGroup : 0;
        return (
          <div
            key={tab.key}
            className={clsx("mobile-tab-item", { active })}
            onClick={() => navigate(tab.path)}
          >
            <Badge count={badgeCount} size="small" offset={[4, 0]}>
              {tab.key === "mine" ? (
                <OIMAvatar
                  src={selfInfo.faceURL}
                  text={selfInfo.nickname}
                  size={22}
                />
              ) : (
                <img
                  src={active ? tab.activeIcon : tab.icon}
                  alt=""
                  width={22}
                  height={22}
                />
              )}
            </Badge>
            <span className="mobile-tab-label">{tab.label}</span>
          </div>
        );
      })}
    </nav>
  );
};

export default MobileTabBar;
