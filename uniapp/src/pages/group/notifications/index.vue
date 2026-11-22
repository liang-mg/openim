<template>
  <view class="app-page">
    <page-header title="群通知">
      <template #right>
        <view class="gn-add" @tap="goJoin"><app-icon name="plus" :size="14" color="var(--brand)" /><text class="gn-add-text">加入群组</text></view>
      </template>
    </page-header>

    <view class="px-3 pt-3 pb-7">
      <view class="gn-tabs flex items-center gap-1 p-1 rounded-ctl bg-white mb-3">
        <view v-for="t in tabs" :key="t.value" class="gn-tab flex-1 h-8 rounded-ctl flex items-center justify-center" :class="tab === t.value ? 'gn-tab--active bg-brand-soft' : ''" @tap="tab = t.value">
          <text class="text-base" :class="tab === t.value ? 'text-brand font-semibold' : 'text-ink-3'">{{ t.label }}</text>
        </view>
      </view>

      <view v-if="loading" class="oa-card"><skeleton :lines="4" :height="16" /></view>
      <empty-state v-else-if="error" :text="error" name="users" />
      <empty-state v-else-if="!visible.length" :text="tab === 'received' ? '还没有收到群申请' : '还没有发出群申请'" name="users" />

      <view v-else class="oa-card gn-list">
        <view v-for="app in visible" :key="app.id" class="gn-row">
          <view class="gn-icon">群</view>
          <view class="gn-main">
            <view class="flex items-center justify-between gap-2">
              <text class="gn-name">{{ app.groupName || app.groupID }}</text>
              <text class="gn-time">{{ fromNow(app.createTime) }}</text>
            </view>
            <text class="gn-sub">{{ app.nickname || app.userID }} 申请加入</text>
            <text v-if="app.reqMsg" class="gn-msg">{{ app.reqMsg }}</text>
            <view v-if="app.handleResult === 0 && tab === 'received'" class="gn-actions">
              <view class="gn-btn gn-btn--ok" :class="{ 'opacity-50': busyID === app.id }" @tap="decide(app, true)">同意</view>
              <view class="gn-btn gn-btn--no" :class="{ 'opacity-50': busyID === app.id }" @tap="decide(app, false)">拒绝</view>
            </view>
            <text v-else class="gn-status">{{ statusText(app) }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import PageHeader from "@/components/page-header.vue";
import AppIcon from "@/components/app-icon.vue";
import EmptyState from "@/components/empty-state.vue";
import Skeleton from "@/components/skeleton.vue";
import { getGroupApplications, handleGroupApplication, on } from "@/api/im";
import { fromNow } from "@/utils/format";

/** 群通知：收到的入群申请 / 我发出的申请。 */
export default {
  components: { PageHeader, AppIcon, EmptyState, Skeleton },
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
      if (!p || p.type === "group") this.load();
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
      return this.tab === "received" ? "待处理" : "等待群主/管理员验证";
    },
    goJoin() {
      uni.navigateTo({ url: "/pages/contact/add-group/index" });
    },
    async load() {
      this.loading = true;
      this.error = "";
      try {
        const [received, sent] = await Promise.all([
          getGroupApplications("received"),
          getGroupApplications("sent"),
        ]);
        this.received = received;
        this.sent = sent;
      } catch (e) {
        this.error = e.message || "群申请加载失败";
      } finally {
        this.loading = false;
      }
    },
    async decide(app, accept) {
      if (this.busyID) return;
      this.busyID = app.id;
      try {
        await handleGroupApplication({
          groupID: app.groupID,
          fromUserID: app.userID,
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
.gn-add {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 14px;
  background: #fff;
}

.gn-add-text {
  font-size: 11px;
  color: var(--brand);
}

.gn-tabs {
  border: 1px solid var(--line);
}

.gn-list {
  padding: 0;
  overflow: hidden;
}

.gn-row {
  display: flex;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
}

.gn-row:last-child {
  border-bottom: none;
}

.gn-icon {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  background: var(--ok-soft);
  color: var(--ok-text);
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.gn-main {
  flex: 1;
  min-width: 0;
}

.gn-name {
  font-size: 15px;
  color: var(--ink);
  font-weight: 500;
}

.gn-time {
  font-size: 10px;
  color: var(--ink-4);
  flex-shrink: 0;
}

.gn-sub {
  display: block;
  margin-top: 3px;
  font-size: 12px;
  color: var(--ink-2);
}

.gn-msg {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--ink-3);
}

.gn-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.gn-btn {
  min-width: 62px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}

.gn-btn--ok {
  background: var(--brand);
  color: #fff;
}

.gn-btn--no {
  background: var(--fill-2);
  color: var(--ink-2);
}

.gn-status {
  display: inline-block;
  margin-top: 6px;
  font-size: 11px;
  color: var(--ink-4);
}
</style>
