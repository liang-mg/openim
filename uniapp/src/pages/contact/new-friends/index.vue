<template>
  <view class="app-page">
    <page-header title="新的朋友">
      <template #right>
        <view class="nf-add" @tap="goAdd"><app-icon name="plus" :size="14" color="var(--brand)" /><text class="nf-add-text">添加</text></view>
      </template>
    </page-header>

    <view class="px-3 pt-3 pb-7">
      <view class="nf-tabs flex items-center gap-1 p-1 rounded-ctl bg-white mb-3">
        <view v-for="t in tabs" :key="t.value" class="nf-tab flex-1 h-8 rounded-ctl flex items-center justify-center" :class="tab === t.value ? 'nf-tab--active bg-brand-soft' : ''" @tap="tab = t.value">
          <text class="text-base" :class="tab === t.value ? 'text-brand font-semibold' : 'text-ink-3'">{{ t.label }}</text>
        </view>
      </view>

      <view v-if="loading" class="oa-card"><skeleton :lines="4" :height="16" /></view>
      <empty-state v-else-if="error" :text="error" name="user" />
      <empty-state v-else-if="!visible.length" :text="tab === 'received' ? '还没有收到好友申请' : '还没有发出好友申请'" name="user" />

      <view v-else class="oa-card nf-list">
        <view v-for="app in visible" :key="app.id" class="nf-row">
          <oim-avatar :text="(app.nickname || '?').slice(0, 1)" :size="42" />
          <view class="nf-main">
            <view class="flex items-center justify-between gap-2">
              <text class="nf-name">{{ app.nickname || app.userID }}</text>
              <text class="nf-time">{{ fromNow(app.createTime) }}</text>
            </view>
            <text class="nf-msg">{{ app.reqMsg || (tab === "received" ? "请求添加你为好友" : "等待对方验证") }}</text>
            <view v-if="app.handleResult === 0 && tab === 'received'" class="nf-actions">
              <view class="nf-btn nf-btn--ok" :class="{ 'opacity-50': busyID === app.id }" @tap="decide(app, true)">同意</view>
              <view class="nf-btn nf-btn--no" :class="{ 'opacity-50': busyID === app.id }" @tap="decide(app, false)">拒绝</view>
            </view>
            <text v-else class="nf-status">{{ statusText(app) }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import PageHeader from "@/components/page-header.vue";
import AppIcon from "@/components/app-icon.vue";
import OimAvatar from "@/components/oim-avatar.vue";
import EmptyState from "@/components/empty-state.vue";
import Skeleton from "@/components/skeleton.vue";
import { getFriendApplications, handleFriendApplication, on } from "@/api/im";
import { fromNow } from "@/utils/format";

/**
 * 新的朋友：收到的 / 我发出的好友申请。
 * 收到的未处理申请可直接同意/拒绝；同意后通讯录会刷新。
 */
export default {
  components: { PageHeader, AppIcon, OimAvatar, EmptyState, Skeleton },
  data() {
    return {
      tabs: [
        { value: "received", label: "收到的" },
        { value: "sent", label: "我发出的" },
      ],
      tab: "received",
      received: [],
      sent: [],
      loading: true,
      error: "",
      busyID: "",
      offApp: null,
    };
  },
  computed: {
    visible() {
      return this.tab === "received" ? this.received : this.sent;
    },
  },
  onShow() {
    if (!this.offApp) this.offApp = on("application", (p) => {
      if (!p || p.type === "friend") this.load();
    });
    this.load();
  },
  onUnload() {
    if (this.offApp) this.offApp();
  },
  methods: {
    fromNow,
    statusText(app) {
      if (app.handleResult === 1) return "已同意";
      if (app.handleResult === -1) return "已拒绝";
      return this.tab === "received" ? "待处理" : "等待对方验证";
    },
    goAdd() {
      uni.navigateTo({ url: "/pages/contact/add-friend/index" });
    },
    async load() {
      this.loading = true;
      this.error = "";
      try {
        const [received, sent] = await Promise.all([
          getFriendApplications("received"),
          getFriendApplications("sent"),
        ]);
        this.received = received.filter((a) => a.incoming);
        this.sent = sent.filter((a) => !a.incoming);
      } catch (e) {
        this.error = e.message || "好友申请加载失败";
      } finally {
        this.loading = false;
      }
    },
    async decide(app, accept) {
      if (this.busyID) return;
      this.busyID = app.id;
      try {
        await handleFriendApplication({
          toUserID: app.userID,
          accept,
          handleMsg: accept ? "同意" : "拒绝",
        });
        app.handleResult = accept ? 1 : -1;
        uni.showToast({ title: accept ? "已同意" : "已拒绝", icon: "none" });
        this.load();
      } catch (e) {
        uni.showToast({ title: e.message || "操作失败", icon: "none" });
      } finally {
        this.busyID = "";
      }
    },
  },
};
</script>

<style scoped>
.nf-add {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 14px;
  background: var(--card);
}

.nf-add-text {
  font-size: 11px;
  color: var(--brand);
}

.nf-tabs {
  border: 1px solid var(--line);
}

.nf-tab--active {
  box-shadow: 0 1px 2px rgba(11, 95, 216, 0.08);
}

.nf-list {
  padding: 0;
  overflow: hidden;
}

.nf-row {
  display: flex;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
}

.nf-row:last-child {
  border-bottom: none;
}

.nf-main {
  flex: 1;
  min-width: 0;
}

.nf-name {
  font-size: 15px;
  color: var(--ink);
  font-weight: 500;
}

.nf-time {
  font-size: 10px;
  color: var(--ink-4);
  flex-shrink: 0;
}

.nf-msg {
  display: block;
  margin-top: 3px;
  font-size: 12px;
  color: var(--ink-3);
  line-height: 1.5;
}

.nf-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.nf-btn {
  min-width: 62px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}

.nf-btn--ok {
  background: var(--brand);
  color: var(--on-primary);
}

.nf-btn--no {
  background: var(--fill-2);
  color: var(--ink-2);
}

.nf-status {
  display: inline-block;
  margin-top: 6px;
  font-size: 11px;
  color: var(--ink-4);
}
</style>
