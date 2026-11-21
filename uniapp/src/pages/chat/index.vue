<template>
  <view class="chat">
    <view class="chat__header flex items-center px-2 bg-white border-b border-line shrink-0">
      <view class="chat__back w-9 flex items-center justify-center" @tap="back">
        <app-icon name="chevron-left" :size="22" color="var(--ink)" />
      </view>
      <view class="flex-1 min-w-0 flex flex-col items-center">
        <text class="chat__title block text-[16px] font-semibold text-ink max-w-[220px] overflow-hidden whitespace-nowrap text-ellipsis">{{ name || "聊天" }}</text>
        <text v-if="isGroup" class="chat__sub text-2xs text-ink-4">{{ memberText }}</text>
      </view>
      <view class="chat__header-right w-9 flex justify-end">
        <text v-if="connState !== 'connected'" class="chat__state text-2xs text-warn-text">{{ connState === "connecting" ? "连接中" : "未连接" }}</text>
      </view>
    </view>

    <message-list
      :messages="messages"
      :self-text="selfText"
      :is-group="isGroup"
      :conn-state="connState"
      :has-more="hasMore"
      :loading-more="loadingMore"
      :anchor="anchor"
      @load-more="loadMore"
      @retry="resend"
    />

    <composer v-model="draft" :disabled="connState !== 'connected'" :read-only="readOnly" :hint="composerHint" @send="send" />
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";
import MessageList from "./components/message-list.vue";
import Composer from "./components/composer.vue";
import { getMessages, sendTextMessage, markConversationRead, connect, getState, on, IM_MODE } from "@/api/im";
import { useUserStore } from "@/store/user";
import { getToken } from "@/utils/storage";

const PAGE_SIZE = 20;

/**
 * 聊天详情。对应 PC 端 frontend/src/pages/chat/queryChat：
 *   顶部标题（群聊带人数）、消息流（时间条 / 对方带昵称 / 自己靠右）、底部输入。
 * 页面只留生命周期与状态；消息区在 components/message-list.vue，输入区在 components/composer.vue。
 * 性能：一次只渲染 20 条，往上翻再取 20 条；布局是唯一允许「固定高度 + 内部滚动」的页面。
 */
export default {
  components: { AppIcon, MessageList, Composer },
  data() {
    return {
      conversationID: "",
      name: "",
      isGroup: false,
      memberCount: 0,
      messages: [],
      hasMore: true,
      loadingMore: false,
      draft: "",
      anchor: "",
      connState: "idle",
      sending: false,
      offState: null,
      offMsg: null,
    };
  },
  computed: {
    /** 后端通知模式：只能看，不能发（能力边界要在界面上说清楚，而不是点了才报错） */
    readOnly() {
      return IM_MODE === "api";
    },
    composerHint() {
      if (this.readOnly) return "当前是系统通知模式，仅可查看（发消息需 OpenIM）";
      return this.connState === "connected" ? "发消息…" : "IM 未连接，无法发送";
    },
    selfText() {
      return (useUserStore().displayName || "我").slice(0, 1);
    },
    memberText() {
      return this.memberCount ? `${this.memberCount} 人` : "";
    },
  },
  onLoad(options) {
    this.conversationID = decodeURIComponent(options.conversationID || "");
    this.name = decodeURIComponent(options.name || "");
    this.isGroup = options.group === "1";
    this.memberCount = Number(options.members || 0) || (this.isGroup ? 6 : 0);
  },
  async onShow() {
    if (!getToken()) {
      uni.reLaunch({ url: "/pages/login/index" });
      return;
    }
    if (!this.offState) this.offState = on("state", (s) => { this.connState = s; });
    if (!this.offMsg) this.offMsg = on("message", (p) => this.onIncoming(p));
    // 自己气泡的头像首字要用真实姓名
    useUserStore().fetchProfile().catch(() => {});
    this.connState = getState();
    if (this.connState !== "connected") {
      try {
        await connect();
      } catch (e) {
        uni.showToast({ title: e.message, icon: "none", duration: 2600 });
      }
      this.connState = getState();
    }
    if (!this.messages.length) await this.loadInitial();
  },
  onUnload() {
    if (this.offState) this.offState();
    if (this.offMsg) this.offMsg();
  },
  methods: {
    async loadInitial() {
      try {
        const { list, hasMore } = await getMessages(this.conversationID, { limit: PAGE_SIZE });
        this.messages = list;
        this.hasMore = hasMore;
        await markConversationRead(this.conversationID);
        this.scrollToBottom();
      } catch (e) {
        uni.showToast({ title: e.message || "消息加载失败", icon: "none" });
      }
    },
    async loadMore() {
      if (this.loadingMore || !this.hasMore || !this.messages.length) return;
      this.loadingMore = true;
      const first = this.messages[0];
      // 记下锚点，加载完把视图留在原来的第一条上，避免跳动
      const anchorID = `m_${first.clientMsgID}`;
      try {
        const { list, hasMore } = await getMessages(this.conversationID, { before: first.sendTime, limit: PAGE_SIZE });
        this.messages = [...list, ...this.messages];
        this.hasMore = hasMore;
        this.$nextTick(() => { this.anchor = anchorID; });
      } catch (e) {
        uni.showToast({ title: e.message || "加载失败", icon: "none" });
      } finally {
        this.loadingMore = false;
      }
    },
    /** IM 推来的新消息：只收本会话别人发的，自己发的走 send 的返回值，避免重复 */
    onIncoming(payload) {
      const m = payload && payload.message;
      if (!m || payload.conversationID !== this.conversationID || m.isSelf) return;
      if (this.messages.some((x) => x.clientMsgID === m.clientMsgID)) return;
      this.messages.push(m);
      this.scrollToBottom();
    },
    async send() {
      if (this.readOnly) {
        uni.showToast({ title: "当前是系统通知模式，只能查看；发消息需要 OpenIM（imMode=sdk）", icon: "none", duration: 2600 });
        return;
      }
      const text = String(this.draft || "").trim();
      if (!text || this.sending) return;
      if (this.connState !== "connected") {
        uni.showToast({ title: "IM 未连接，无法发送", icon: "none" });
        return;
      }
      this.draft = "";
      this.sending = true;
      // 先插一条「发送中」的气泡，失败再标红并允许重发
      const temp = { clientMsgID: `tmp_${Date.now()}`, sendTime: Date.now(), isSelf: true, senderName: "我", text, status: "sending" };
      this.messages.push(temp);
      this.scrollToBottom();
      try {
        const sent = await sendTextMessage(this.conversationID, text);
        const idx = this.messages.findIndex((m) => m.clientMsgID === temp.clientMsgID);
        if (idx >= 0) this.messages.splice(idx, 1, sent);
        this.scrollToBottom();
      } catch (e) {
        const idx = this.messages.findIndex((m) => m.clientMsgID === temp.clientMsgID);
        if (idx >= 0) this.messages.splice(idx, 1, { ...temp, status: "failed" });
      } finally {
        this.sending = false;
      }
    },
    async resend(m) {
      m.status = "sending";
      try {
        const sent = await sendTextMessage(this.conversationID, m.text);
        const idx = this.messages.findIndex((x) => x.clientMsgID === m.clientMsgID);
        if (idx >= 0) this.messages.splice(idx, 1, sent);
        this.scrollToBottom();
      } catch (e) {
        m.status = "failed";
      }
    },
    scrollToBottom() {
      this.$nextTick(() => {
        this.anchor = "";
        setTimeout(() => { this.anchor = "chat_bottom"; }, 30);
      });
    },
    back() {
      const pages = getCurrentPages();
      if (pages.length > 1) uni.navigateBack();
      else uni.reLaunch({ url: "/pages/message/index" });
    },
  },
};
</script>

<style scoped>
/* 聊天页是唯一允许「固定高度 + 内部滚动」的页面：输入框必须钉在底部 */
.chat {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  background: var(--bg);
  overflow: hidden;
}

.chat__header {
  height: calc(52px + var(--status-bar-height, 0px));
  padding-top: var(--status-bar-height, 0px);
}
</style>
