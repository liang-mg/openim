<template>
  <view class="app-page msg">
    <view class="app-topbar">
      <text class="app-topbar__title">消息</text>
      <view class="msg__right">
        <text v-if="!connected" class="msg__state">IM 未连接</text>
        <view v-if="totalUnread" class="msg__unread"><text class="msg__unread-text">{{ totalUnread > 99 ? "99+" : totalUnread }}</text></view>
        <view class="msg__add" @tap="showAddMenu">
          <app-icon name="plus" :size="26" tone="card" />
        </view>
        <view class="msg__bell" @tap="goNotifications">
          <app-icon name="bell" :size="26" tone="card" />
        </view>
      </view>
    </view>

    <view class="msg__search">
      <input v-model="keyword" class="msg__search-input" placeholder="搜索会话" placeholder-class="msg__ph" confirm-type="search" />
    </view>

    <view v-if="error" class="msg__error" @tap="bootstrap">
      <text class="msg__error-text">{{ error }}，点击重试</text>
    </view>

    <view class="msg__list">
      <view v-if="loading && !list.length && !error" class="px-3 pt-3">
        <view class="oa-card"><skeleton :lines="5" :height="16" /></view>
      </view>
      <view v-else-if="!filtered.length" class="empty"><text>{{ keyword ? "没有匹配的会话" : "暂无会话" }}</text></view>

      <conv-row v-for="conv in filtered" :key="conv.conversationID" :conv="conv" @open="openChat" />

      <view class="page-bottom-space" />
    </view>

    <app-tabbar active="chat" :unread="totalUnread" />
  </view>
</template>

<script>
import { hideNativeTabBar, preloadTabPages } from "@/utils/tabbar";
import OimAvatar from "@/components/oim-avatar.vue";
import AppIcon from "@/components/app-icon.vue";
import AppTabbar from "@/components/app-tabbar.vue";
import ConvRow from "./components/conv-row.vue";
import Skeleton from "@/components/skeleton.vue";
import { listConversations, totalUnread, connect, getState, on } from "@/api/im";
import { getToken } from "@/utils/storage";
import { peek, put } from "@/utils/swr";
import { useUserStore } from "@/store/user";
import { useIMStore } from "@/store/im";

/**
 * 会话列表。对应 PC 端 frontend/src/pages/chat/ConversationSider。
 * 除了首屏加载，还会监听 IM 的新消息/会话变化/未读数，正在看列表时不需要手动刷新。
 */
export default {
  components: { OimAvatar, AppIcon, AppTabbar, ConvRow, Skeleton },
  data() {
    return {
      list: [],
      totalUnread: useIMStore().unread,
      keyword: "",
      connected: false,
      connState: "idle",
      error: "",
      loading: true,
      busy: false,
      reloadTimer: null,
      emptyRetryTimer: null,
      emptyRetryCount: 0,
      lastLoadedAt: 0,
      offSync: null,
      offState: null,
      offMsg: null,
      offConv: null,
      offUnread: null,
      offApp: null,
    };
  },
  computed: {
    filtered() {
      const k = this.keyword.trim();
      if (!k) return this.list;
      return this.list.filter((c) => String(c.showName || "").includes(k) || String((c.lastMessage && c.lastMessage.text) || "").includes(k));
    },
  },
  onShow() {
    hideNativeTabBar();
    if (!getToken()) {
      uni.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.bindListeners();
    this.connState = getState();
    this.connected = this.connState === "connected";
    useUserStore()
      .fetchProfile()
      .catch(() => {});
    // 页面实例保留（switchTab）时，刚拉过就不再重复请求；实时消息靠事件更新
    if (this.list.length && Date.now() - this.lastLoadedAt < 2500) return;
    this.bootstrap();
    // 登录后预热其余 tab，首次切换不再现场加载页面
    setTimeout(() => preloadTabPages(), 1200);
  },
  onUnload() {
    if (this.offState) this.offState();
    if (this.offMsg) this.offMsg();
    if (this.offConv) this.offConv();
    if (this.offUnread) this.offUnread();
    if (this.offApp) this.offApp();
    if (this.offSync) this.offSync();
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    if (this.emptyRetryTimer) clearTimeout(this.emptyRetryTimer);
  },
  onHide() {
    // 切到聊天/其他页时停止后台轮询，回来 onShow 会重新拉
    if (this.emptyRetryTimer) {
      clearTimeout(this.emptyRetryTimer);
      this.emptyRetryTimer = null;
    }
  },
  methods: {
    bindListeners() {
      if (!this.offState) {
        this.offState = on("state", (s) => {
          this.connState = s;
          this.connected = s === "connected";
          if (s === "connected") this.load();
        });
      }
      if (!this.offMsg) {
        this.offMsg = on("message", (payload) => this.onMessage(payload));
      }
      if (!this.offConv) {
        this.offConv = on("conversation", (conv) => this.onConversation(conv));
      }
      if (!this.offUnread) {
        this.offUnread = on("unread", (n) => {
          this.totalUnread = Number(n || 0);
          useIMStore().setUnread(this.totalUnread);
        });
      }
      if (!this.offApp) {
        this.offApp = on("application", () => {
          // 好友/群申请不直接改会话，但联系人页刷新时用得到；这里只做轻量提示
        });
      }
      if (!this.offSync) {
        // App 端首次同步可能超过连接超时；同步完成后必须主动补拉一次，
        // 否则首屏会一直空列表，只能切 tab 才刷新。
        this.offSync = on("sync", () => this.load());
      }
    },
    goNotifications() {
      uni.navigateTo({ url: "/pages/notifications/index" });
    },
    showAddMenu() {
      uni.showActionSheet({
        itemList: ["添加好友", "创建群聊", "加入群组"],
        success: (res) => {
          if (res.tapIndex === 0) uni.navigateTo({ url: "/pages/contact/add-friend/index" });
          else if (res.tapIndex === 1) uni.navigateTo({ url: "/pages/group/create/index" });
          else uni.navigateTo({ url: "/pages/contact/add-group/index" });
        },
      });
    },
    async bootstrap() {
      this.error = "";
      const cached = peek("im:conversations");
      if (cached) {
        this.list = cached.list || [];
        this.totalUnread = cached.unread || 0;
        useIMStore().setUnread(this.totalUnread);
      }
      try {
        await connect();
      } catch (e) {
        this.connected = false;
        this.connState = getState();
        this.error = e.message || "IM 连接失败";
      }
      this.connected = getState() === "connected";
      // 不再“只有 connected 才 load”：listConversations 自己会等连接；
      // 同步慢时也要把请求发出去，sync 事件到了会再补一次。
      await this.load();
      this.scheduleEmptyRetry();
    },
    async load() {
      if (this.busy) return;
      this.busy = true;
      this.loading = true;
      try {
        const [list, unread] = await Promise.all([listConversations(), totalUnread()]);
        this.list = Array.isArray(list) ? list : [];
        this.totalUnread = Number(unread || 0);
        useIMStore().setUnread(this.totalUnread);
        this.error = "";
        this.connected = getState() === "connected";
        this.lastLoadedAt = Date.now();
        put("im:conversations", { list: this.list, unread: this.totalUnread });
        if (this.list.length) {
          this.emptyRetryCount = 0;
          if (this.emptyRetryTimer) clearTimeout(this.emptyRetryTimer);
          this.emptyRetryTimer = null;
        }
      } catch (e) {
        if (!peek("im:conversations")) {
          this.list = [];
          this.totalUnread = 0;
        }
        this.error = e.message || "会话加载失败";
      } finally {
        this.loading = false;
        this.busy = false;
      }
    },
    scheduleEmptyRetry() {
      if (this.list.length || this.emptyRetryCount >= 40 || this.emptyRetryTimer) return;
      this.emptyRetryCount += 1;
      this.emptyRetryTimer = setTimeout(async () => {
        this.emptyRetryTimer = null;
        if (this.list.length || !getToken()) return;
        await this.load();
        if (!this.busy) this.scheduleEmptyRetry();
      }, 1200);
    },
    scheduleReload() {
      if (this.reloadTimer) clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => {
        this.reloadTimer = null;
        this.load();
      }, 350);
    },
    onMessage(payload) {
      const m = payload && payload.message;
      const cid = payload && payload.conversationID;
      if (!m || !cid) return;
      const idx = this.list.findIndex((c) => c.conversationID === cid);
      if (idx < 0) {
        // 新会话不在当前列表里：拉一次完整列表，避免猜字段
        this.scheduleReload();
        return;
      }
      const conv = { ...this.list[idx] };
      conv.lastMessage = m;
      conv.lastTime = m.sendTime || Date.now();
      if (!m.isSelf) conv.unreadCount = Number(conv.unreadCount || 0) + 1;
      this.list.splice(idx, 1);
      this.list.unshift(conv);
    },
    onConversation(next) {
      if (!next || !next.conversationID) return;
      const idx = this.list.findIndex((c) => c.conversationID === next.conversationID);
      if (idx >= 0) this.list.splice(idx, 1, { ...this.list[idx], ...next });
      else this.list.unshift(next);
      this.list.sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0));
    },
    async openChat(conv) {
      await uni.navigateTo({
        url: `/pages/chat/index?conversationID=${encodeURIComponent(conv.conversationID)}&name=${encodeURIComponent(conv.showName || "")}&group=${conv.isGroup ? 1 : 0}`,
      });
    },
  },
};
</script>

<style scoped>
.msg__right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.msg__add {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.msg__bell {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: -8px;
}

.msg__state {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.2);
}

.msg__unread {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--card);
  display: flex;
  align-items: center;
  justify-content: center;
}

.msg__unread-text {
  font-size: 10px;
  color: var(--brand);
  font-weight: 600;
}

.msg__search {
  padding: 8px 12px;
  background: var(--card);
  border-bottom: 1px solid var(--line);
}

.msg__search-input {
  height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  background: var(--fill-2);
  font-size: 13px;
}

.msg__ph {
  color: var(--ink-4);
}

.msg__error {
  padding: 6px 12px;
  background: var(--danger-soft-2);
  border-bottom: 1px solid #ffccc7;
}

.msg__error-text {
  font-size: 11px;
  color: var(--danger-strong);
}

.msg__list {
  background: var(--card);
}
</style>
