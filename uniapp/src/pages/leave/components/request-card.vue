<template>
  <view class="oa-card">
    <view class="flex items-center justify-between gap-2">
      <view class="flex items-baseline gap-1.5 min-w-0">
        <text class="text-md font-semibold text-ink">{{ record.user_name }}</text>
        <text class="text-xs text-brand bg-brand-soft rounded px-1.5 py-px">{{ kindText }}</text>
      </view>
      <status-tag :text="statusText" :tone="statusTone" />
    </view>

    <view class="flex items-baseline gap-2 mt-2">
      <text class="text-sm text-ink">{{ timeText }}</text>
      <text v-if="daysText" class="text-xs text-ink-3">{{ daysText }}</text>
    </view>

    <text class="block mt-1.5 text-sm text-ink-2 leading-5">{{ record.reason }}</text>

    <view class="flex flex-col gap-0.5 mt-1.5">
      <text class="text-2xs text-ink-4">审批人：{{ approverText }}</text>
      <text v-if="record.comment" class="text-2xs text-ink-3">意见：{{ record.comment }}</text>
    </view>

    <attachment-links :leave-id="record.leave_id" :items="attachments" />

    <view v-if="actions.length" class="flex justify-end gap-4 mt-2 pt-2 border-t border-line">
      <text
        v-for="a in actions"
        :key="a.key"
        class="card-action text-sm"
        :class="a.tone === 'primary' ? 'text-brand font-medium' : a.tone === 'danger' ? 'text-danger' : 'text-ink-2'"
        @tap="$emit('action', { key: a.key, record })"
      >
        {{ a.label }}
      </text>
    </view>
  </view>
</template>

<script>
import StatusTag from "@/components/status-tag.vue";
import AttachmentLinks from "./attachment-links.vue";
import { LEAVE_TYPE_TEXT, REQUEST_STATUS_TEXT } from "@/api/oa";

const STATUS_TONE = { pending: "pending", approved: "success", rejected: "danger", cancelled: "muted" };

/**
 * 请假 / 补卡共用的一张申请卡。
 *
 * 两者字段不同但版式一致：kind 决定类型文案与时间行的拼法，
 * 页面只关心「点了哪个动作」，不用再写两遍卡片模板。
 */
export default {
  name: "RequestCard",
  components: { StatusTag, AttachmentLinks },
  props: {
    record: { type: Object, required: true },
    kind: { type: String, default: "leave" }, // leave | makeup
    tab: { type: String, default: "mine" },
  },
  emits: ["action"],
  computed: {
    isLeave() {
      return this.kind === "leave";
    },
    kindText() {
      if (this.isLeave) return LEAVE_TYPE_TEXT[this.record.type] || this.record.type;
      return this.record.type === "on" ? "上班卡" : "下班卡";
    },
    timeText() {
      const r = this.record;
      if (this.isLeave) return r.end_date && r.end_date !== r.start_date ? `${r.start_date} ~ ${r.end_date}` : r.start_date;
      return `${r.date} ${r.time || ""}`.trim();
    },
    daysText() {
      return this.isLeave ? `${this.record.days} 天` : "";
    },
    /** 只有请假申请带附件；补卡接口返回里没有这个字段 */
    attachments() {
      if (!this.isLeave) return [];
      return this.record.attachments || [];
    },
    approverText() {
      const r = this.record;
      return r.approver_name || (r.status === "pending" ? "待指派" : "—");
    },
    statusText() {
      return REQUEST_STATUS_TEXT[this.record.status] || this.record.status;
    },
    statusTone() {
      return STATUS_TONE[this.record.status] || "muted";
    },
    actions() {
      const r = this.record;
      if (r.status !== "pending") return [];
      if (this.tab === "mine") return [{ key: "cancel", label: "撤销", tone: "default" }];
      return [
        { key: "approve", label: "同意", tone: "primary" },
        { key: "reject", label: "拒绝", tone: "danger" },
      ];
    },
  },
};
</script>
