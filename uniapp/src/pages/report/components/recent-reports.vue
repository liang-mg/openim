<template>
  <view class="oa-card">
    <text class="block text-lg font-semibold text-ink mb-1.5">最近报告</text>

    <text v-if="!list.length" class="block py-3.5 text-sm text-ink-4">还没有报告</text>

    <view v-for="r in list" :key="r.report_id" class="flex items-center gap-2 py-2.5 border-t border-line">
      <view class="flex-1 min-w-0 flex flex-col gap-0.5">
        <text class="text-base text-ink">{{ r.period.slice(5) }} {{ reportTypeText(r.type) }}</text>
      </view>

      <view v-if="canWithdraw(r)" class="rrow__withdraw px-2.5 py-1 rounded-pill bg-warn-soft" @tap="$emit('withdraw', r.report_id)">
        <text class="text-xs text-warn-text">撤回</text>
      </view>

      <status-tag :text="statusText(r.status)" :tone="statusTone(r.status)" />
    </view>
  </view>
</template>

<script>
import StatusTag from "@/components/status-tag.vue";
import { reportTypeText } from "@/api/oa";

const STATUS_TEXT = { draft: "草稿", submitted: "待查阅", pending_leader: "待领导查阅", archived: "已归档" };
const STATUS_TONE = { draft: "muted", submitted: "brand", pending_leader: "pending", archived: "success" };
const WITHDRAW_WINDOW = 2 * 60 * 60 * 1000;

/** 最近报告列表：撤回窗口（2 小时）判定放在组件里，页面不再关心 */
export default {
  name: "RecentReports",
  components: { StatusTag },
  props: {
    list: { type: Array, default: () => [] },
  },
  emits: ["withdraw"],
  methods: {
    reportTypeText,
    statusText(status) {
      return STATUS_TEXT[status] || status;
    },
    statusTone(status) {
      return STATUS_TONE[status] || "muted";
    },
    canWithdraw(r) {
      return r.status === "submitted" && r.submit_time != null && Date.now() - r.submit_time <= WITHDRAW_WINDOW;
    },
  },
};
</script>
