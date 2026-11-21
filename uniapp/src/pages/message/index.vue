<template>
  <view class="app-page msg">
    <view class="app-topbar">
      <text class="app-topbar__title">消息</text>
      <view class="msg__right">
        <text v-if="!connected" class="msg__state">IM 未连接</text>
        <view v-if="totalUnread" class="msg__unread"><text class="msg__unread-text">{{ totalUnread > 99 ? "99+" : totalUnread }}</text></view>
        <!-- 通知中心入口（系统通知与 IM 会话分开，避免混在一起） -->
        <view class="msg__bell" @tap="goNotifications">
          <app-icon name="bell" :size="20" color="#ffffff" />
        </view>
      </view>
    </view>

    <view class="msg__search">
      <input v-model="keyword" class="msg__search-input" placeholder="搜索会话" placeholder-class="msg__ph" confirm-type="search" />
    </view>

    <view class="msg__list">
      <view v-if="!filtered.length" class="empty"><text>{{ keyword ? "没有匹配的会话" : "暂无会话" }}</text></view>

      <conv-row v-for="conv in filtered" :key="conv.conversationID" :conv="conv" @open="openChat" />

      <view v-if="isMock" class="msg__tip">
        <text class="msg__tip-text">当前为本地假数据（VITE_IM_MODE=mock）。接入 OpenIM 后同一套页面直接可用。</text>
      </view>
      <view class="page-bottom-space" />
    </view>

    <app-tabbar active="chat" :unread="totalUnread" />
  </view>
</template>

<script>
import OimAvatar from "@/components/oim-avatar.vue";
import AppIcon from "@/components/app-icon.vue";
import AppTabbar from "@/components/app-tabbar.vue";
import ConvRow from "./components/conv-row.vue";
import { listConversations, totalUnread, connect, getState, isMock, on } from "@/api/im";
import { getToken } from "@/utils/storage";
import { peek, put } from "@/utils/swr";
import { useUserStore } from "@/store/user";

/**
 * 会话列表。对应 PC 端 frontend/src/pages/chat/ConversationSider：
 * 头像（群聊带标记）、名称、最后一条消息（群聊带发送者）、时间、未读角标。
 * 顶部多了连接状态：IM 没连上时明确提示，不让用户以为「没消息」。
 */
export default {
  components: { OimAvatar, AppIcon, AppTabbar, ConvRow },
  data() {
    return {
      list: [],
      totalUnread: 0,
      keyword: "",
      connected: false,
      isMock: isMock(),
      offState: null,
    };
  },
  computed: {
    filtered() {
      const k = this.keyword.trim();
      if (!k) return this.list;
      return this.list.filter((c) => String(c.showName || "").includes(k) || String(c.lastMessage.text || "").includes(k));
    },
  },
  onShow() {
    if (!getToken()) {
      uni.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.offState = on("state", (s) => {
      this.connected = s === "connected";
    });
    // 头像首字要用真实姓名，顺手把身份拉回来（失败不阻塞）
    useUserStore()
      .fetchProfile()
      .catch(() => {});
    this.bootstrap();
  },
  onUnload() {
    if (this.offState) this.offState();
  },
  methods: {
    goNotifications() {
      uni.navigateTo({ url: "/pages/notifications/index" });
    },
    async bootstrap() {
      // 先铺缓存（切回消息 tab 时几乎零等待），再连 IM 并刷新
      const cached = peek("im:conversations");
      if (cached) {
        this.list = cached.list || [];
        this.totalUnread = cached.unread || 0;
      }
      const connecting = connect().catch((e) => {
        this.connected = false;
        uni.showToast({ title: e.message, icon: "none", duration: 2600 });
      });
      if (isMock()) {
        // mock 数据不依赖连接：先出列表，别让 400ms 的握手挡住首屏
        await this.load();
        await connecting;
      } else {
        // 真实 SDK：会话必须先连上才拿得到，只能等
        await connecting;
        await this.load();
      }
      this.connected = getState() === "connected";
    },
    async load() {
      try {
        const [list, unread] = await Promise.all([listConversations(), totalUnread()]);
        this.list = list;
        this.totalUnread = unread;
        put("im:conversations", { list, unread });
      } catch (e) {
        if (!peek("im:conversations")) {
          this.list = [];
          this.totalUnread = 0;
        }
        uni.showToast({ title: e.message || "会话加载失败", icon: "none" });
      }
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

.msg__bell {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: -6px;
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
  background: #fff;
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
  background: #fff;
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

.msg__list {
  background: #fff;
}


.conv:active {
  background: var(--fill);
}












.msg__tip {
  padding: 16px 16px 4px;
}

.msg__tip-text {
  font-size: 10px;
  color: var(--ink-4);
  text-align: center;
  display: block;
  line-height: 1.6;
}
</style>
