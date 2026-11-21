<template>
  <view class="tabbar">
    <view
      v-for="tab in tabs"
      :key="tab.key"
      class="tabbar__item"
      :class="{ 'tabbar__item--active': active === tab.key }"
      @tap="go(tab)"
    >
      <view class="tabbar__icon-wrap">
        <oim-avatar v-if="tab.key === 'mine'" :text="avatarText" :size="22" />
        <image v-else class="tabbar__icon" :src="active === tab.key ? tab.activeIcon : tab.icon" mode="aspectFit" />
        <view v-if="tab.badge > 0" class="tabbar__badge">
          <text class="tabbar__badge-text">{{ tab.badge > 99 ? "99+" : tab.badge }}</text>
        </view>
      </view>
      <text class="tabbar__label">{{ tab.label }}</text>
    </view>
    <view class="tabbar__safe" />
  </view>
</template>

<script>
import OimAvatar from "@/components/oim-avatar.vue";
import { useUserStore } from "@/store/user";

/**
 * 底部导航，与 PC 端 frontend/src/layout/MobileTabBar 对齐：
 *   消息 / 通讯录 / 工作 / 我 —— 4 个入口，「我」用头像而不是图标，
 *   进入详情页时由页面自己传 visible=false 隐藏。
 *
 * 用 reLaunch 切页：这些页面没有做成原生 tabBar，避免 tab 栈叠加和状态残留。
 */
export default {
  name: "AppTabbar",
  components: { OimAvatar },
  props: {
    active: { type: String, default: "chat" },
    unread: { type: Number, default: 0 },
    visible: { type: Boolean, default: true },
  },
  computed: {
    avatarText() {
      // 「我」用头像首字，与 PC 端 MobileTabBar 一致
      return useUserStore().avatarText || "我";
    },
    tabs() {
      return [
        {
          key: "chat",
          label: "消息",
          path: "/pages/message/index",
          icon: "/static/tabbar/nav_bar_message.png",
          activeIcon: "/static/tabbar/nav_bar_message_active.png",
          badge: this.unread,
        },
        {
          key: "contact",
          label: "通讯录",
          path: "/pages/contact/index",
          icon: "/static/tabbar/nav_bar_contact.png",
          activeIcon: "/static/tabbar/nav_bar_contact_active.png",
          badge: 0,
        },
        {
          key: "work",
          label: "工作",
          path: "/pages/work/index",
          icon: "/static/tabbar/nav_bar_workbench.png",
          activeIcon: "/static/tabbar/nav_bar_workbench_active.png",
          badge: 0,
        },
        {
          key: "mine",
          label: "我",
          path: "/pages/mine/index",
          icon: "",
          activeIcon: "",
          badge: 0,
        },
      ];
    },
  },
  methods: {
    go(tab) {
      if (this.active === tab.key) return;
      uni.reLaunch({ url: tab.path });
    },
  },
};
</script>

<style scoped>
.tabbar {
  position: fixed;
  left: 50%;
  bottom: 0;
  transform: translateX(-50%);
  width: 100%;
  max-width: 480px;
  display: flex;
  align-items: center;
  height: 56px;
  padding-bottom: env(safe-area-inset-bottom);
  background: #fff;
  border-top: 1px solid var(--line);
  z-index: 20;
}

.tabbar__item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 100%;
}

.tabbar__icon-wrap {
  position: relative;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tabbar__icon {
  width: 22px;
  height: 22px;
}

.tabbar__label {
  font-size: 10px;
  color: var(--ink-3);
  line-height: 1;
}

.tabbar__item--active .tabbar__label {
  color: var(--brand);
}

.tabbar__badge {
  position: absolute;
  top: -4px;
  right: -10px;
  min-width: 14px;
  height: 14px;
  padding: 0 4px;
  border-radius: 7px;
  background: var(--danger);
  display: flex;
  align-items: center;
  justify-content: center;
}

.tabbar__badge-text {
  color: #fff;
  font-size: 9px;
  line-height: 1;
}

.tabbar__safe {
  display: none;
}
</style>
