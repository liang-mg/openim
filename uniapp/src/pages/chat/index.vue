<template>
  <view class="chat" :style="chatStyle">
    <view class="chat__header flex items-center px-2 bg-white border-b border-line shrink-0">
      <view class="chat__back w-9 flex items-center justify-center" @tap="back">
        <app-icon name="chevron-left" :size="22" color="var(--ink)" />
      </view>
      <view class="flex-1 min-w-0 flex flex-col items-center" @tap="openInfo">
        <text class="chat__title block text-[16px] font-semibold text-ink max-w-[220px] overflow-hidden whitespace-nowrap text-ellipsis">{{ name || "聊天" }}</text>
        <text v-if="isGroup" class="chat__sub text-2xs text-ink-4">{{ memberText }}</text>
      </view>
      <view class="chat__header-right w-9 flex justify-end">
        <text v-if="connState !== 'connected'" class="chat__state text-2xs text-warn-text">{{ connStateText }}</text>
      </view>
    </view>

    <view v-if="connState !== 'connected'" class="chat__banner" @tap="retryConnect">
      <text class="chat__banner-text">{{ connState === "connecting" ? "正在连接 IM…" : "IM 未连接，点击重连（发送的消息会先保存）" }}</text>
    </view>
    <view v-if="loadError" class="chat__error" @tap="reload">
      <text class="chat__error-text">消息加载失败：{{ loadError }}，点击重试</text>
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
      @scroll="onScroll"
    />

    <composer
      v-model="draft"
      :disabled="connState === 'connecting'"
      :hint="composerHint"
      @send="send"
      @focus="onInputFocus"
      @blur="onInputBlur"
    />
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";
import MessageList from "./components/message-list.vue";
import Composer from "./components/composer.vue";
import {
  connect,
  reconnect,
  getMessages,
  sendTextMessage,
  markConversationRead,
  getState,
  on,
} from "@/api/im";
import { targetOfConversation } from "@/api/im/common";
import { useUserStore } from "@/store/user";
import { getToken, getUserId } from "@/utils/storage";
import * as outbox from "@/utils/imOutbox";

const PAGE_SIZE = 20;

function localID() {
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 聊天详情。
 * 可靠性要点：
 *  - 发送前先落 outbox；发送超时/失败标红，重进会话还能看到并重发；
 *  - 服务端历史 + outbox 合并去重，按 clientMsgID 对齐；
 *  - 连接断开/网络恢复可手动重连，页面显示真实状态；
 *  - 收到新消息/从后台回来会增量刷新，不打断用户正在看的历史。
 */
export default {
  components: { AppIcon, MessageList, Composer },
  data() {
    return {
      conversationID: "",
      name: "",
      isGroup: false,
      memberCount: 0,
      peerID: "",
      groupID: "",
      messages: [],
      hasMore: true,
      loadingMore: false,
      loadingInitial: false,
      loadError: "",
      loaded: false,
      draft: "",
      anchor: "",
      connState: "idle",
      nearBottom: true,
      userID: "",
      offState: null,
      offMsg: null,
      offSync: null,
      readTimer: null,
      keyboardHeight: 0,
      baseInnerHeight: 0,
      inputFocused: false,
      keyboardTimer: null,
      keyboardRecheck: null,
      offKeyboard: null,
      offViewport: null,
    };
  },
  computed: {
    chatStyle() {
      return this.keyboardHeight > 0 ? { paddingBottom: `${this.keyboardHeight}px` } : {};
    },
    composerHint() {
      if (this.connState === "connecting") return "正在连接 IM…";
      if (this.connState !== "connected") return "IM 未连接，发送会先保存";
      return "发消息…";
    },
    connStateText() {
      if (this.connState === "connecting") return "连接中";
      if (this.connState === "offline") return "离线";
      if (this.connState === "failed") return "未连接";
      return "未连接";
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
    this.memberCount = Number(options.members || 0);
    this.userID = getUserId();
    this.setupKeyboard();
    const target = targetOfConversation(this.conversationID, this.userID);
    this.peerID = target.recvID;
    this.groupID = target.groupID;
    if (!this.isGroup && (this.groupID || String(this.conversationID).startsWith("sg_"))) this.isGroup = true;
  },
  async onShow() {
    if (!getToken()) {
      uni.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.bindListeners();
    this.connState = getState();
    useUserStore().fetchProfile().catch(() => {});

    if (this.loaded) {
      if (this.connState === "connected") this.refreshLatest();
      else if (this.connState !== "connecting") this.tryConnect();
      return;
    }
    // 先显示本地 outbox，再连服务器拉历史：断网重进也能立刻看到失败消息
    await this.loadInitial();
  },
  onUnload() {
    if (this.offState) this.offState();
    if (this.offMsg) this.offMsg();
    if (this.offSync) this.offSync();
    if (this.readTimer) clearTimeout(this.readTimer);
    if (this.keyboardTimer) clearTimeout(this.keyboardTimer);
    if (this.keyboardRecheck) clearTimeout(this.keyboardRecheck);
    // #ifdef APP-PLUS
    try {
      if (this.offKeyboard && typeof uni.offKeyboardHeightChange === "function") uni.offKeyboardHeightChange(this.offKeyboard);
    } catch (e) {
      /* ignore */
    }
    // #endif
    // #ifdef H5
    try {
      if (this.offViewport && typeof window !== "undefined") {
        window.visualViewport.removeEventListener("resize", this.offViewport);
        window.visualViewport.removeEventListener("scroll", this.offViewport);
      }
    } catch (e) {
      /* ignore */
    }
    // #endif
  },
  methods: {
    setupKeyboard() {
      // #ifdef APP-PLUS
      this.baseInnerHeight = typeof window !== "undefined" ? Number(window.innerHeight || 0) : 0;
      if (typeof uni.onKeyboardHeightChange === "function") {
        this.offKeyboard = (res) => this.applyKeyboard(res && res.height, "app");
        uni.onKeyboardHeightChange(this.offKeyboard);
      }
      // #endif
      // #ifdef H5
      if (typeof window !== "undefined" && window.visualViewport) {
        this.offViewport = () => {
          const vv = window.visualViewport;
          const kh = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
          this.applyKeyboard(kh, "h5");
        };
        window.visualViewport.addEventListener("resize", this.offViewport);
        window.visualViewport.addEventListener("scroll", this.offViewport);
      }
      // #endif
    },
    applyKeyboard(height, source = "") {
      let next = Math.max(0, Math.min(500, Math.round(Number(height) || 0)));
      // #ifdef APP-PLUS
      // vivo 等机型在 adjustResize 下 WebView 已经自己缩到键盘上方；
      // 再给根节点 padding-bottom 会把输入框顶到屏幕中间（鸿蒙不缩，反而需要 padding）。
      // 用 window.innerHeight 判断这次是否真的被系统压缩了。
      if (source === "app" && next > 0 && this.baseInnerHeight > 0) {
        const shrunk = this.baseInnerHeight - Number(window.innerHeight || 0);
        if (shrunk > Math.max(80, next * 0.45)) next = 0;
      }
      // #endif
      if (next === this.keyboardHeight) return;
      this.keyboardHeight = next;
      // App 端键盘事件可能先于 WebView resize 到达：第一次按高度加了 padding，
      // 等 300ms 再确认一次；如果系统已经把视口压缩，就把 padding 撤掉，避免双重上推。
      // #ifdef APP-PLUS
      if (this.keyboardRecheck) clearTimeout(this.keyboardRecheck);
      this.keyboardRecheck = null;
      if (next > 0 && source === "app") {
        this.keyboardRecheck = setTimeout(() => {
          this.keyboardRecheck = null;
          if (this.keyboardHeight <= 0 || !this.baseInnerHeight) return;
          const shrunk = this.baseInnerHeight - Number(window.innerHeight || 0);
          if (shrunk > Math.max(80, this.keyboardHeight * 0.45)) this.keyboardHeight = 0;
        }, 300);
      }
      // #endif
      if (next > 0) {
        this.$nextTick(() => this.scrollToBottom(true));
      }
    },
    onInputFocus() {
      this.inputFocused = true;
      if (this.keyboardTimer) {
        clearTimeout(this.keyboardTimer);
        this.keyboardTimer = null;
      }
      setTimeout(() => {
        if (this.inputFocused) {
          this.scrollToBottom(true);
          this.applyKeyboard(this.keyboardHeight);
        }
      }, 180);
    },
    onInputBlur() {
      this.inputFocused = false;
      if (this.keyboardTimer) clearTimeout(this.keyboardTimer);
      this.keyboardTimer = setTimeout(() => {
        if (!this.inputFocused) this.applyKeyboard(0);
      }, 260);
    },
    bindListeners() {
      if (!this.offState) {
        this.offState = on("state", (s) => {
          this.connState = s;
          if (s === "connected") {
            if (!this.loaded) this.loadInitial();
            else this.refreshLatest();
          }
        });
      }
      if (!this.offMsg) {
        this.offMsg = on("message", (payload) => this.onIncoming(payload));
      }
      if (!this.offSync) {
        this.offSync = on("sync", () => {
          if (this.loaded) this.refreshLatest();
          else this.loadInitial();
        });
      }
    },
    async tryConnect() {
      try {
        await connect();
      } catch (e) {
        // 连接失败不阻塞展示本地待发消息；用户可点 banner 重连
        this.loadError = this.loadError || e.message || "IM 连接失败";
      }
      this.connState = getState();
    },
    async reload() {
      this.loadError = "";
      this.loaded = false;
      await this.loadInitial();
    },
    outboxMessages() {
      const rows = outbox.list(this.userID, this.conversationID);
      return rows.map((r) => {
        let status = r.status;
        let error = r.error || "";
        if (status === "sending") {
          // 页面重进时没有在途任务，历史 sending 一律视为上次未完成
          status = "failed";
          error = error || "上次未发送完成";
          outbox.upsert(this.userID, { ...r, status: "failed", error });
        }
        return {
          clientMsgID: r.clientMsgID,
          sendTime: r.sendTime,
          isSelf: true,
          senderName: "我",
          text: r.text,
          status,
          error,
          outbox: true,
        };
      });
    },
    mergeServer(server, local) {
      const map = new Map();
      (server || []).forEach((m) => {
        if (m && m.clientMsgID) map.set(String(m.clientMsgID), m);
      });
      (local || []).forEach((m) => {
        if (m && m.clientMsgID && !map.has(String(m.clientMsgID))) map.set(String(m.clientMsgID), m);
      });
      return [...map.values()].sort(
        (a, b) => (a.sendTime || 0) - (b.sendTime || 0) || String(a.clientMsgID).localeCompare(String(b.clientMsgID))
      );
    },
    reconcileOutbox(server) {
      if (!server || !server.length) return;
      const ids = new Set(server.map((m) => String(m.clientMsgID)));
      outbox.list(this.userID, this.conversationID).forEach((r) => {
        if (ids.has(String(r.clientMsgID))) outbox.remove(this.userID, this.conversationID, r.clientMsgID);
      });
    },
    async loadInitial() {
      if (this.loadingInitial) return;
      this.loadingInitial = true;
      this.loadError = "";
      // 先把本地待发消息显示出来，断网也能看到失败记录
      this.messages = this.mergeServer([], this.outboxMessages());
      try {
        const { list, hasMore } = await getMessages(this.conversationID, { limit: PAGE_SIZE });
        this.reconcileOutbox(list);
        this.messages = this.mergeServer(list, this.outboxMessages());
        this.hasMore = hasMore;
        this.loaded = true;
        await this.markRead();
        this.scrollToBottom(true);
      } catch (e) {
        this.loadError = e.message || "消息加载失败";
      } finally {
        this.loadingInitial = false;
      }
    },
    async refreshLatest() {
      if (this.loadingInitial || !this.loaded) return;
      try {
        const { list } = await getMessages(this.conversationID, { limit: PAGE_SIZE });
        this.reconcileOutbox(list);
        this.messages = this.mergeServer(this.messages, list);
        await this.markRead();
        if (this.nearBottom) this.scrollToBottom(false);
      } catch (e) {
        /* 后台刷新失败不打扰用户，下次进入/重连再试 */
      }
    },
    async loadMore() {
      if (this.loadingMore || !this.hasMore) return;
      const first = this.messages.find(
        (m) => m && m.clientMsgID && !String(m.clientMsgID).startsWith("local_") && !m.outbox
      );
      if (!first) {
        this.hasMore = false;
        return;
      }
      this.loadingMore = true;
      const anchorID = `m_${first.clientMsgID}`;
      try {
        const { list, hasMore } = await getMessages(this.conversationID, {
          beforeClientMsgID: first.clientMsgID,
          limit: PAGE_SIZE,
        });
        this.messages = this.mergeServer(list, this.messages);
        this.hasMore = hasMore;
        this.$nextTick(() => {
          this.anchor = anchorID;
        });
      } catch (e) {
        uni.showToast({ title: e.message || "加载失败", icon: "none" });
      } finally {
        this.loadingMore = false;
      }
    },
    appendOrReplace(m) {
      if (!m || !m.clientMsgID) return;
      const idx = this.messages.findIndex((x) => x.clientMsgID === m.clientMsgID);
      if (idx >= 0) {
        this.messages.splice(idx, 1, m);
        return;
      }
      let pos = this.messages.length;
      while (pos > 0 && (this.messages[pos - 1].sendTime || 0) > (m.sendTime || 0)) pos--;
      this.messages.splice(pos, 0, m);
    },
    replaceMessage(oldID, next) {
      if (!next || !next.clientMsgID) return;
      const existing = this.messages.findIndex((x) => x.clientMsgID === next.clientMsgID);
      if (existing >= 0) {
        // 服务端/事件已经先到：删掉旧占位，保留服务端那条
        const old = this.messages.findIndex((x) => x.clientMsgID === oldID);
        if (old >= 0 && old !== existing) this.messages.splice(old, 1);
        const cur = this.messages.findIndex((x) => x.clientMsgID === next.clientMsgID);
        if (cur >= 0) this.messages.splice(cur, 1, next);
        return;
      }
      const old = this.messages.findIndex((x) => x.clientMsgID === oldID);
      if (old >= 0) this.messages.splice(old, 1, next);
      else this.appendOrReplace(next);
    },
    onIncoming(payload) {
      const m = payload && payload.message;
      if (!m || !m.clientMsgID || payload.conversationID !== this.conversationID) return;
      this.appendOrReplace(m);
      outbox.remove(this.userID, this.conversationID, m.clientMsgID);
      if (!m.isSelf) {
        this.scheduleRead();
        if (this.nearBottom) this.scrollToBottom(false);
      } else if (!m.outbox) {
        // 自己在其他端发的消息，当前页也补上
        if (this.nearBottom) this.scrollToBottom(false);
      }
    },
    scheduleRead() {
      if (this.readTimer) clearTimeout(this.readTimer);
      this.readTimer = setTimeout(() => {
        this.readTimer = null;
        this.markRead();
      }, 250);
    },
    async markRead() {
      if (getState() !== "connected") return;
      try {
        await markConversationRead(this.conversationID);
      } catch (e) {
        /* 已读失败不阻塞 */
      }
    },
    queueFailed(text, error) {
      const local = {
        clientMsgID: localID(),
        sendTime: Date.now(),
        isSelf: true,
        senderName: "我",
        text,
        status: "failed",
        error: error || "IM 未连接",
      };
      this.appendOrReplace(local);
      outbox.upsert(this.userID, { ...local, conversationID: this.conversationID, status: "failed" });
      this.scrollToBottom(true);
      uni.showToast({ title: "IM 未连接，消息已保存，恢复后可重发", icon: "none" });
      this.tryConnect().catch(() => {});
    },
    async send() {
      const text = String(this.draft || "").trim();
      if (!text) return;
      this.draft = "";
      if (this.connState !== "connected") {
        // 离线也先保存：用户不会以为消息丢了；重连后点气泡重发
        this.queueFailed(text, "IM 未连接");
        return;
      }

      let pending = null;
      try {
        const sent = await sendTextMessage(this.conversationID, text, {
          onPending: (p) => {
            pending = p;
            this.appendOrReplace(p);
            outbox.upsert(this.userID, { ...p, conversationID: this.conversationID, status: "sending" });
            this.scrollToBottom(true);
          },
        });
        if (pending) {
          this.replaceMessage(pending.clientMsgID, sent);
          outbox.remove(this.userID, this.conversationID, pending.clientMsgID);
        } else {
          this.appendOrReplace(sent);
        }
        outbox.remove(this.userID, this.conversationID, sent.clientMsgID);
        this.scrollToBottom(true);
      } catch (e) {
        if (pending) {
          pending.status = "failed";
          pending.error = e.message || e.code || "发送失败";
          this.replaceMessage(pending.clientMsgID, { ...pending, status: "failed", error: pending.error });
          outbox.upsert(this.userID, { ...pending, conversationID: this.conversationID, status: "failed" });
          uni.showToast({ title: `发送失败：${pending.error}`.slice(0, 42), icon: "none", duration: 3000 });
        } else if (e && e.code === "IM_OFFLINE") {
          // 检查时还连着、真正发送时已经断网：同样落 outbox，别把用户输入丢掉
          this.queueFailed(text, "IM 未连接");
        } else {
          uni.showToast({ title: e.message || "发送失败", icon: "none" });
        }
      }
    },
    async resend(m) {
      if (!m || m.status === "sending") return;
      // App 端第一次失败多半是长连接已经半死；先强制 logout/login 一次，
      // 清掉原生发送队列，再重发。H5 的 reconnect 会整页刷新，不能在点击重发时调。
      // #ifdef APP-PLUS
      if (this.connState === "connected") {
        uni.showToast({ title: "正在重连 IM…", icon: "none" });
        try {
          await reconnect();
        } catch (e) {
          this.connState = getState();
          uni.showToast({ title: e.message || "重连失败，请检查网络/VPN", icon: "none" });
          return;
        }
      }
      // #endif
      if (this.connState !== "connected") {
        this.tryConnect().catch(() => {});
        uni.showToast({ title: "IM 未连接，先重连再重发", icon: "none" });
        return;
      }
      m.status = "sending";
      m.error = "";
      outbox.upsert(this.userID, { ...m, conversationID: this.conversationID, status: "sending" });
      try {
        const sent = await sendTextMessage(this.conversationID, m.text);
        this.replaceMessage(m.clientMsgID, sent);
        outbox.remove(this.userID, this.conversationID, m.clientMsgID);
        outbox.remove(this.userID, this.conversationID, sent.clientMsgID);
        this.scrollToBottom(true);
      } catch (e) {
        m.status = "failed";
        m.error = e.message || e.code || "发送失败";
        outbox.upsert(this.userID, { ...m, conversationID: this.conversationID, status: "failed" });
        uni.showToast({ title: `发送失败：${m.error}`.slice(0, 42), icon: "none", duration: 3000 });
      }
    },
    async retryConnect() {
      if (this.connState === "connecting") return;
      this.loadError = "";
      try {
        if (this.connState === "connected") return;
        await reconnect();
      } catch (e) {
        this.connState = getState();
        uni.showToast({ title: e.message || "重连失败，请检查网络/VPN", icon: "none" });
      }
    },
    onScroll(e) {
      const d = (e && e.detail) || e || {};
      const sh = Number(d.scrollHeight || 0);
      const st = Number(d.scrollTop || 0);
      const ch = Number(d.clientHeight || 0);
      if (sh && ch) this.nearBottom = sh - st - ch < 120;
    },
    scrollToBottom(force) {
      if (!force && !this.nearBottom) return;
      this.nearBottom = true;
      this.$nextTick(() => {
        this.anchor = "";
        setTimeout(() => {
          this.anchor = "chat_bottom";
        }, 30);
      });
    },
    openInfo() {
      if (this.isGroup || this.groupID) {
        if (!this.groupID) return;
        uni.navigateTo({ url: `/pages/group/settings/index?groupID=${encodeURIComponent(this.groupID)}` });
        return;
      }
      if (!this.peerID) return;
      uni.navigateTo({
        url: `/pages/contact/user-card/index?userID=${encodeURIComponent(this.peerID)}&name=${encodeURIComponent(this.name || "")}`,
      });
    },
    back() {
      const pages = getCurrentPages();
      if (pages.length > 1) uni.navigateBack();
      else uni.switchTab({ url: "/pages/message/index" });
    },
  },
};
</script>

<style scoped>
/* 聊天页是唯一允许「固定高度 + 内部滚动」的页面：输入框必须钉在底部 */
.chat {
  /* 固定到视口：键盘弹起时输入焦点不会把整个页面滚走（vivo 上会丢标题/顶飞输入框） */
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  height: auto;
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  background: var(--bg);
  overflow: hidden;
  box-sizing: border-box;
  transition: padding-bottom 0.12s ease-out;
}

.chat__header {
  height: calc(52px + var(--status-bar-height, 0px));
  padding-top: var(--status-bar-height, 0px);
}

.chat__banner {
  padding: 6px 12px;
  background: var(--warn-soft);
  border-bottom: 1px solid #ffe0b2;
}

.chat__banner-text {
  font-size: 11px;
  color: var(--warn-strong-2);
}

.chat__error {
  padding: 6px 12px;
  background: var(--danger-soft-2);
  border-bottom: 1px solid #ffccc7;
}

.chat__error-text {
  font-size: 11px;
  color: var(--danger-strong);
}
</style>
