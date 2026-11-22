<template>
  <view class="app-page">
    <page-header title="审批中心" @back="back">
      <template #right>
        <text v-if="canManage" class="text-sm text-white/90" @tap="doScan">扫描异常</text>
        <text class="text-sm text-white/90" @tap="reload">刷新</text>
      </template>
    </page-header>

    <scroll-view class="ap-tabs" scroll-x :show-scrollbar="false">
      <view v-for="t in tabs" :key="t.value" class="ap-tab" :class="{ 'ap-tab--active': tab === t.value }" @tap="switchTab(t.value)">
        <text class="text-base" :class="tab === t.value ? 'text-brand font-semibold' : 'text-ink-2'">{{ t.label }}</text>
      </view>
    </scroll-view>

    <view class="px-3.5 py-2 bg-page">
      <text class="text-xs text-ink-3 leading-5">{{ hint }}</text>
    </view>

    <!-- 待办 / 我发起的 / 已处理 -->
    <view v-if="tab !== 'report-rate'" class="px-3 pt-3 pb-7">
      <empty-state v-if="loading" text="加载中…" />
      <empty-state v-else-if="!list.length" :text="tab === 'pending' ? '暂无待处理事项' : '暂无记录'" name="check-square" />
      <approval-item v-for="item in list" v-else :key="`${item.kind}-${item.id}`" :item="item" :tab="tab" @op="onItemOp" />
    </view>

    <!-- 日报提交率 -->
    <view v-else class="px-3 pt-3 pb-7">
      <view class="flex items-center gap-3 mb-2.5">
        <picker mode="date" :value="rateDate" @change="onRateDateChange">
          <view class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-ctl bg-white">
            <app-icon name="calendar" :size="13" tone="ink-2" />
            <text class="text-sm text-ink">{{ rateDate }}</text>
          </view>
        </picker>
        <text class="text-sm text-ink-2 px-1" @tap="loadRate">刷新</text>
        <view class="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-ctl bg-brand" @tap="doUrge">
          <app-icon name="send" :size="13" color="#ffffff" />
          <text class="text-sm text-white">{{ busy ? "处理中…" : "催交未提交" }}</text>
        </view>
      </view>

      <view v-if="rate" class="rounded-card bg-white px-3 py-2.5 mb-2.5">
        <text class="text-sm text-ink-2">
          全范围 {{ rate.done }}/{{ rate.total }} 已交，提交率
          <text class="font-semibold" :style="{ color: rate.rate >= 80 ? 'var(--ok-text)' : 'var(--danger)' }">{{ rate.rate }}%</text>
        </text>
      </view>

      <empty-state v-if="rateLoading" text="加载中…" />
      <empty-state v-else-if="!rateRows.length" text="暂无数据" name="chart" />
      <rate-card v-for="row in rateRows" v-else :key="row.department" :row="row" />
    </view>

    <action-sheet
      :open="action.open"
      :title="actionTitle"
      :item="action.item"
      v-model="action.comment"
      :busy="busy"
      @close="action.open = false"
      @confirm="doAction"
    />
  </view>
</template>

<script>
import PageHeader from "@/components/page-header.vue";
import AppIcon from "@/components/app-icon.vue";
import EmptyState from "@/components/empty-state.vue";
import ApprovalItem from "./components/approval-item.vue";
import RateCard from "./components/rate-card.vue";
import ActionSheet from "./components/action-sheet.vue";
import {
  getApprovalList,
  getMe,
  getSubmitRate,
  approveLeave,
  approveMakeup,
  handleException,
  appealException,
  scanExceptions,
  urgeReports,
} from "@/api/oa";
import { getToken } from "@/utils/storage";
import { toUniPath } from "@/utils/nav";

const HINTS = {
  pending: "待我处理：下属的请假、补卡、考勤异常，以及待点评/待审阅的日报",
  mine: "我发起的申请与我的考勤异常",
  done: "我已处理过的记录",
  "report-rate": "按部门统计当日日报提交情况，可一键催交未提交的人",
};

/**
 * 审批中心（页面层）。
 *
 * 这里只做三件事：取数、切换四档、把卡片上的动作转成接口调用。
 * 卡片渲染在 components/approval-item.vue，提交率卡片在 components/rate-card.vue，
 * 处理意见弹层在 components/action-sheet.vue —— 单个文件都不超过 200 行。
 */
export default {
  components: { PageHeader, AppIcon, EmptyState, ApprovalItem, RateCard, ActionSheet },
  data() {
    return {
      me: null,
      tab: "pending",
      list: [],
      pending: 0,
      loading: true,
      busy: false,
      action: { open: false, item: {}, action: "approve", comment: "" },
      rateDate: "",
      rate: null,
      rateLoading: false,
      rateRows: [],
    };
  },
  computed: {
    canManage() {
      return Boolean(this.me && this.me.can_view_team);
    },
    tabs() {
      const base = [
        { label: this.pending > 0 ? `待我处理 (${this.pending})` : "待我处理", value: "pending" },
        { label: "我发起的", value: "mine" },
        { label: "已处理", value: "done" },
      ];
      if (this.canManage) base.push({ label: "日报提交", value: "report-rate" });
      return base;
    },
    hint() {
      return HINTS[this.tab] || "";
    },
    actionTitle() {
      const { item, action } = this.action;
      if (action === "appeal") return "申诉考勤异常";
      if (item.kind === "exception") return action === "resolve" ? "认定这条异常" : "忽略这条异常";
      if (item.kind === "leave") return action === "approve" ? "通过请假申请" : "拒绝请假申请";
      return action === "approve" ? "通过补卡申请" : "拒绝补卡申请";
    },
  },
  onLoad(options) {
    if (options && options.tab) this.tab = options.tab;
    this.rateDate = this.todayKey();
  },
  onShow() {
    if (!getToken()) {
      uni.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.init();
  },
  methods: {
    todayKey() {
      // 北京时间，避免设备时区导致"今天"算错
      const d = new Date(Date.now() + 8 * 3600 * 1000);
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    },
    async init() {
      try {
        this.me = await getMe();
      } catch (e) {
        /* 身份失败不阻断列表，权限由服务端兜底 */
      }
      await this.load();
    },
    reload() {
      if (this.tab === "report-rate") this.loadRate();
      else this.load();
    },
    switchTab(value) {
      if (this.tab === value) return;
      this.tab = value;
      if (value === "report-rate") this.loadRate();
      else this.load();
    },
    async load() {
      this.loading = true;
      try {
        const data = await getApprovalList({ tab: this.tab });
        this.list = data.list || [];
        this.pending = data.pending || 0;
      } catch (e) {
        this.list = [];
        uni.showToast({ title: e.message || "加载失败", icon: "none" });
      } finally {
        this.loading = false;
      }
    },
    async loadRate() {
      this.rateLoading = true;
      try {
        const data = await getSubmitRate({ date: this.rateDate });
        this.rate = data;
        this.rateRows = data.rows || [];
      } catch (e) {
        this.rate = null;
        this.rateRows = [];
        uni.showToast({ title: e.message || "加载提交率失败", icon: "none" });
      } finally {
        this.rateLoading = false;
      }
    },
    onRateDateChange(e) {
      this.rateDate = e.detail.value;
      this.loadRate();
    },
    onItemOp({ item, key }) {
      if (key === "view") {
        this.go(item.path);
        return;
      }
      this.action = { open: true, item, action: key, comment: "" };
    },
    async doAction() {
      if (this.busy) return;
      const { item, action } = this.action;
      const comment = String(this.action.comment || "").trim();
      if (!comment) {
        uni.showToast({ title: "请填写处理意见", icon: "none" });
        return;
      }
      this.busy = true;
      try {
        if (item.kind === "leave") {
          await approveLeave({ leaveId: item.id, action, comment });
        } else if (item.kind === "makeup") {
          await approveMakeup({ makeupId: item.id, action, comment });
        } else if (item.kind === "exception") {
          if (action === "appeal") await appealException(item.id, comment);
          else await handleException({ exceptionId: item.id, action, comment });
        }
        uni.showToast({ title: "已处理", icon: "none" });
        this.action.open = false;
        await this.load();
      } catch (e) {
        uni.showToast({ title: e.message || "处理失败", icon: "none" });
      } finally {
        this.busy = false;
      }
    },
    async doScan() {
      try {
        const r = await scanExceptions(3);
        uni.showToast({ title: `扫描完成：新增 ${r.created} 条，已存在 ${r.skipped} 条`, icon: "none" });
        await this.load();
      } catch (e) {
        uni.showToast({ title: e.message || "扫描失败", icon: "none" });
      }
    },
    async doUrge() {
      if (this.busy) return;
      this.busy = true;
      try {
        const r = await urgeReports(this.rateDate);
        const suffix = r.pushed ? "（已同步 IM）" : "（仅站内信，未配置 IM 推送）";
        uni.showToast({ title: `已催交 ${r.urged} 人，跳过 ${r.skipped} 人 ${suffix}`, icon: "none", duration: 2800 });
        await this.loadRate();
      } catch (e) {
        uni.showToast({ title: e.message || "催交失败", icon: "none" });
      } finally {
        this.busy = false;
      }
    },
    go(path) {
      const page = toUniPath(path);
      if (!page) {
        uni.showToast({ title: "该条记录暂无可跳转的移动端页面", icon: "none" });
        return;
      }
      uni.navigateTo({ url: page });
    },
    back() {
      const pages = getCurrentPages();
      if (pages.length > 1) uni.navigateBack();
      else uni.switchTab({ url: "/pages/work/index" });
    },
  },
};
</script>

<style scoped>
.ap-tabs {
  @apply sticky top-13 z-10 flex bg-white border-b border-line whitespace-nowrap;
}

.ap-tab {
  @apply inline-flex items-center justify-center h-11 px-4 relative;
}

.ap-tab--active::after {
  content: "";
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 26px;
  height: 2px;
  background: var(--brand);
  border-radius: 1px;
}
</style>
