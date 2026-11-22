<template>
  <view class="app-page mine">
    <page-header title="我" tone="plain" :back="false" />

    <view class="mine__inner">
      <!-- 个人信息 -->
      <view class="card profile">
        <oim-avatar :text="user.avatarText" :size="56" />
        <view class="profile__info">
          <text class="profile__name">{{ user.displayName }}</text>
          <text class="profile__sub">{{ user.department }}<text v-if="user.position"> · {{ user.position }}</text></text>
          <text class="profile__id">账号：{{ user.profile.user_id || "-" }}</text>
        </view>
        <status-tag :text="user.roleText" tone="brand" />
      </view>

      <!-- 管理入口：仅管理员可见 -->
      <view v-if="user.isAdmin" class="card section">
        <mine-row icon="shield" label="员工与权限" @tap="go('/pages/oa-admin/index')" />
        <!-- 公告列表接口目前只对管理员返回「自己发布的公告」，所以入口只给管理员 -->
        <mine-row icon="bell" label="公告与回执" last @tap="go('/pages/announcements/index')" />
      </view>

      <view class="card section">
        <mine-row icon="settings" label="设置" @tap="notReady('设置')" />
        <mine-row icon="logout" label="退出登录" tone="danger" last @tap="onLogout" />
      </view>

      <view class="mine__foot" @longpress="openEnv">
        <text class="mine__version">{{ appName }} {{ appVersion }}</text>
        <text class="mine__env">{{ envLabel }}</text>
      </view>
      <view class="page-bottom-space" />
    </view>

    <app-tabbar active="mine" />

    <!-- 环境切换（长按版本号）：一次打包，多环境切换，重启生效 -->
    <bottom-sheet :open="envOpen" title="运行环境" desc="留空 = 跟随部署配置（同源）。填 https://域名 可直连指定后端，保存后重启生效。" @close="envOpen = false">
      <form-field label="接口环境" hint="本地=同源代理（H5 开发）；线上=https://im.9ty.lol。保存后重启生效。">
        <view class="mode-row">
          <view class="mode" :class="{ 'mode--active': envMode === 'local' }" @tap="pickEnv('local')">
            <text class="mode__text" :class="{ 'mode__text--active': envMode === 'local' }">本地</text>
          </view>
          <view class="mode" :class="{ 'mode--active': envMode === 'online' }" @tap="pickEnv('online')">
            <text class="mode__text" :class="{ 'mode__text--active': envMode === 'online' }">线上</text>
          </view>
        </view>
      </form-field>

      <form-field label="业务接口地址（OA）">
        <input v-model="envDraft" class="env-input" placeholder="https://oa.example.com" placeholder-class="env-ph" />
      </form-field>

      <form-field label="IM 地址（登录/聊天）" hint="留空 = 跟随业务地址；两套服务可以不同域名">
        <input v-model="imDraft" class="env-input" placeholder="https://im.example.com" placeholder-class="env-ph" />
      </form-field>
      <text class="env-current">当前：{{ envLabel }}</text>
      <template #actions>
        <view class="bs-btn" @tap="resetEnv"><text class="bs-btn__text">恢复默认</text></view>
        <view class="bs-btn bs-btn--primary" @tap="saveEnv"><text class="bs-btn__text bs-btn__text--light">保存并重启</text></view>
      </template>
    </bottom-sheet>
  </view>
</template>

<script>
import { hideNativeTabBar } from "@/utils/tabbar";
import PageHeader from "@/components/page-header.vue";
import AppIcon from "@/components/app-icon.vue";
import StatusTag from "@/components/status-tag.vue";
import BottomSheet from "@/components/bottom-sheet.vue";
import FormField from "@/components/form-field.vue";
import OimAvatar from "@/components/oim-avatar.vue";
import AppTabbar from "@/components/app-tabbar.vue";
import MineRow from "./components/mine-row.vue";
import { CONFIG } from "@/config";
import { useUserStore } from "@/store/user";
import { getToken } from "@/utils/storage";
import { disconnect } from "@/api/im";
import { getOverride, setOverride, clearOverride } from "@/utils/runtimeConfig";

/**
 * 「我」页面。对齐 PC 端 frontend/src/pages/mine/index.tsx，
 * 另加管理员可见的「员工与权限」入口（PC 在左侧导航里）。
 *
 * 长按底部版本号可切换运行环境（写本地存储，重启生效）——给多环境切换用，
 * 只影响接口地址，不影响权限（权限永远在服务端判）。
 */
export default {
  components: { PageHeader, AppIcon, StatusTag, BottomSheet, FormField, OimAvatar, AppTabbar, MineRow },
  data() {
    return {
      appName: CONFIG.appName,
      appVersion: CONFIG.appVersion,
      envOpen: false,
      envDraft: CONFIG.origin || "",
      imDraft: CONFIG.imOrigin || "",
      envMode: "local",
    };
  },
  computed: {
    user() {
      return useUserStore();
    },
    envLabel() {
      const override = getOverride();
      if (override && (override.apiOrigin || override.imOrigin)) {
        return `本地覆盖 · 业务 ${override.apiOrigin || "同源"} · IM ${override.imOrigin || "跟随业务"}${CONFIG.devProxy ? "（开发代理）" : ""}`;
      }
      return `${CONFIG.envName} · 业务 ${CONFIG.rawOrigin || "同源"} · IM ${CONFIG.rawImOrigin || "跟随业务"}${CONFIG.devProxy ? "（开发代理）" : ""}`;
    },
  },
  onShow() {
    hideNativeTabBar();
    if (!getToken()) {
      uni.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.user.fetchProfile().catch(() => {});
  },
  methods: {
    openEnv() {
      this.envDraft = CONFIG.rawOrigin || "";
      this.imDraft = CONFIG.rawImOrigin || "";
      this.envMode = String(CONFIG.rawOrigin || CONFIG.rawImOrigin || "").includes("im.9ty.lol") ? "online" : "local";
      this.envOpen = true;
    },
    go(path) {
      uni.navigateTo({ url: path });
    },
    notReady(name) {
      uni.showToast({ title: `${name} 功能开发中`, icon: "none" });
    },
    onLogout() {
      uni.showModal({
        title: "退出登录",
        content: "确定要退出当前账号吗？",
        success: (res) => {
          if (!res.confirm) return;
          disconnect();
          this.user.logout();
          uni.reLaunch({ url: "/pages/login/index" });
        },
      });
    },
    saveEnv() {
      try {
        if (!this.envDraft && !this.imDraft) clearOverride();
        else setOverride({ apiOrigin: this.envDraft, imOrigin: this.imDraft });
        this.envOpen = false;
        uni.showToast({ title: "已保存，即将重启", icon: "none" });
        setTimeout(() => uni.switchTab({ url: "/pages/mine/index" }), 600);
      } catch (e) {
        uni.showToast({ title: e.message || "保存失败", icon: "none" });
      }
    },
    pickEnv(mode) {
      this.envMode = mode;
      if (mode === "online") {
        this.envDraft = "https://im.9ty.lol";
        this.imDraft = "https://im.9ty.lol";
      } else {
        this.envDraft = "";
        this.imDraft = "";
      }
    },
    resetEnv() {
      clearOverride();
      this.envOpen = false;
      uni.showToast({ title: "已恢复默认，即将重启", icon: "none" });
      setTimeout(() => uni.switchTab({ url: "/pages/mine/index" }), 600);
    },
  },
};
</script>

<style scoped>
.mine__inner {
  padding: 14px 12px 0;
}

.profile {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 14px;
}

.profile__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.profile__name {
  font-size: 17px;
  font-weight: 600;
  color: var(--ink);
}

.profile__sub {
  font-size: 12px;
  color: var(--ink-2);
}

.profile__id {
  font-size: 11px;
  color: var(--sub-text);
}

.section {
  padding: 0 14px;
  margin-bottom: 14px;
}






.mine__foot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 12px 0 24px;
}

.mine__version {
  font-size: 11px;
  color: var(--sub-text);
}

.mine__env {
  font-size: 10px;
  color: var(--ink-4);
}

.env-input {
  height: 42px;
  padding: 0 12px;
  border-radius: 8px;
  background: var(--fill);
  font-size: 14px;
}

.env-ph {
  color: var(--ink-4);
}

.mode-row {
  display: flex;
  gap: 8px;
}

.mode {
  flex: 1;
  height: 36px;
  border-radius: 8px;
  background: var(--fill-2);
  display: flex;
  align-items: center;
  justify-content: center;
}

.mode--active {
  background: var(--brand-soft);
}

.mode__text {
  font-size: 12px;
  color: var(--ink-2);
}

.mode__text--active {
  color: var(--brand);
  font-weight: 600;
}

.env-current {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  color: var(--ink-4);
}

.bs-btn {
  flex: 1;
  height: 44px;
  border-radius: 10px;
  background: var(--fill-2);
  display: flex;
  align-items: center;
  justify-content: center;
}

.bs-btn--primary {
  background: var(--brand);
}

.bs-btn__text {
  font-size: 14px;
  color: var(--ink);
}

.bs-btn__text--light {
  color: var(--on-primary);
}
</style>
