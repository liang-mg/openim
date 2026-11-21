<template>
  <view class="oa-card">
    <view class="flex items-center justify-between mb-2">
      <view class="inline-flex items-center gap-1 px-1.5 py-1 rounded" :style="{ background: kindBg }">
        <app-icon :name="kindIcon" :size="13" :color="kindColor" />
        <text class="text-2xs leading-none" :style="{ color: kindColor }">{{ item.kind_text }}</text>
      </view>
      <status-tag :text="statusText" :tone="statusTone" />
    </view>

    <text class="block text-md font-medium text-ink">{{ item.title }}</text>
    <text v-if="item.subtitle" class="block mt-1 text-sm text-ink-3 leading-5">{{ item.subtitle }}</text>

    <view class="flex items-center gap-1 mt-2">
      <app-icon name="user" :size="12" tone="ink-4" />
      <text class="text-xs text-ink-2">{{ item.user_name }}</text>
      <text v-if="item.department" class="text-xs text-ink-4">· {{ item.department }}</text>
      <text class="ml-auto text-2xs text-ink-4">{{ timeText }}</text>
    </view>

    <view v-if="ops.length" class="flex justify-end gap-4 mt-2.5 pt-2.5 border-t border-line">
      <text
        v-for="op in ops"
        :key="op.key"
        class="text-sm py-0.5"
        :class="op.tone === 'primary' ? 'text-brand font-medium' : op.tone === 'danger' ? 'text-danger' : 'text-ink-2'"
        @tap="$emit('op', { item, key: op.key })"
      >
        {{ op.label }}
      </text>
    </view>
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";
import StatusTag from "@/components/status-tag.vue";
import { EXCEPTION_STATUS_TEXT, REQUEST_STATUS_TEXT } from "@/api/oa";
import { fmtShortDateTime } from "@/utils/checkin";

const REPORT_STATUS_TEXT = { submitted: "待点评", pending_leader: "待审阅", archived: "已归档", draft: "草稿" };
const STATUS_TONE = {
  pending: "pending",
  approved: "success",
  rejected: "danger",
  cancelled: "muted",
  open: "pending",
  appealed: "info",
  resolved: "success",
  ignored: "muted",
  submitted: "pending",
  pending_leader: "info",
  archived: "muted",
};
const KIND = {
  leave: { icon: "calendar", color: "var(--brand)", bg: "var(--brand-soft)" },
  makeup: { icon: "clock", color: "var(--brand)", bg: "var(--brand-soft)" },
  exception: { icon: "warning", color: "#c2410c", bg: "#fff1e6" },
  report: { icon: "document", color: "#3b5bdb", bg: "#eef2ff" },
};

/**
 * 审批中心的一条待办卡片。
 *
 * 从页面里拆出来的原因：一张卡片 60 多行模板 + 4 个分支的动作按钮，
 * 混在页面里既不好读、也没法单独改样式（现在整卡样式走 Tailwind 类）。
 * 页面只负责取数与「点了之后做什么」。
 */
export default {
  name: "ApprovalItem",
  components: { AppIcon, StatusTag },
  props: {
    item: { type: Object, required: true },
    tab: { type: String, default: "pending" },
  },
  emits: ["op"],
  computed: {
    kindIcon() {
      return (KIND[this.item.kind] || KIND.report).icon;
    },
    kindColor() {
      return (KIND[this.item.kind] || KIND.report).color;
    },
    kindBg() {
      return (KIND[this.item.kind] || KIND.report).bg;
    },
    statusText() {
      const { kind, status } = this.item;
      if (kind === "exception") return EXCEPTION_STATUS_TEXT[status] || status;
      if (kind === "report") return REPORT_STATUS_TEXT[status] || status;
      return REQUEST_STATUS_TEXT[status] || status;
    },
    statusTone() {
      return STATUS_TONE[this.item.status] || "muted";
    },
    timeText() {
      return this.item.time ? fmtShortDateTime(this.item.time) : "";
    },
    /** 当前卡片可执行的动作（只决定"显示什么"，真正的权限由服务端判） */
    ops() {
      const { item, tab } = this;
      const canApprove = tab === "pending" && item.can_approve;
      if (canApprove && item.kind === "leave") {
        return [
          { key: "approve", label: "同意", tone: "primary" },
          { key: "reject", label: "拒绝", tone: "danger" },
        ];
      }
      if (canApprove && item.kind === "makeup") {
        return [
          { key: "approve", label: "同意", tone: "primary" },
          { key: "reject", label: "拒绝", tone: "danger" },
        ];
      }
      if (canApprove && item.kind === "exception") {
        return [
          { key: "resolve", label: "认定", tone: "primary" },
          { key: "ignore", label: "忽略", tone: "default" },
        ];
      }
      if (canApprove && item.kind === "report") return [{ key: "view", label: "去审阅", tone: "primary" }];
      if (tab === "mine" && item.kind === "exception" && item.status === "open") {
        return [
          { key: "appeal", label: "申诉", tone: "primary" },
          { key: "view", label: "查看", tone: "default" },
        ];
      }
      return [{ key: "view", label: "查看", tone: "default" }];
    },
  },
};
</script>
