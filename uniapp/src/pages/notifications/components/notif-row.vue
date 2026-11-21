<template>
  <view class="notif-row oa-card" :class="{ 'notif-row--unread': !notice.read }" @tap="onTap">
    <view class="flex items-center gap-2">
      <status-tag :text="kindText" :tone="kindTone" />
      <text class="flex-1 min-w-0 text-md font-semibold text-ink truncate">{{ title }}</text>
      <view v-if="!notice.read" class="w-2 h-2 rounded-full bg-brand shrink-0" />
    </view>
    <view class="flex items-center gap-2 mt-1.5">
      <text class="flex-1 min-w-0 text-sm text-ink-3 truncate">{{ summary }}</text>
      <text class="text-2xs text-ink-4 shrink-0">{{ timeText }}</text>
    </view>
  </view>
</template>

<script>
import StatusTag from "@/components/status-tag.vue";
import { bjShortDateTime } from "@/utils/beijing";

/**
 * 通知列表的一行（类型标签 / 标题 / 内容摘要 / 北京时间 / 未读圆点）。
 *
 * 类型文案按后端实际 kind 给中文：PC 端表格只显示标题与内容，移动端把 kind 抽成标签，
 * 一屏扫下来能分清「请假 / 补卡 / 考勤异常 / 日报 / 催交 / 系统」。
 * 已读行不画圆点；点击未读行时把整条记录抛给页面，由页面调 readNotifications。
 */
const KIND_META = {
  leave: { text: "请假", tone: "brand" },
  leave_pending: { text: "请假", tone: "brand" },
  makeup: { text: "补卡", tone: "pending" },
  makeup_pending: { text: "补卡", tone: "pending" },
  exception: { text: "考勤异常", tone: "danger" },
  report: { text: "日报", tone: "info" },
  report_review: { text: "日报", tone: "info" },
  report_comment: { text: "日报", tone: "info" },
  urge: { text: "催交", tone: "pending" },
  system: { text: "系统", tone: "muted" },
  announcement: { text: "公告", tone: "info" },
  approval: { text: "审批", tone: "success" },
  contract_expiry: { text: "合同", tone: "muted" },
};

const DEFAULT_META = { text: "通知", tone: "muted" };

export default {
  name: "NotifRow",
  components: { StatusTag },
  props: {
    /** 后端通知记录：{ notification_id, kind, title, content, read, created_at } */
    notice: { type: Object, required: true },
  },
  emits: ["read"],
  computed: {
    meta() {
      return KIND_META[this.notice.kind] || DEFAULT_META;
    },
    kindText() {
      return this.meta.text;
    },
    kindTone() {
      return this.meta.tone;
    },
    title() {
      return this.notice.title || "通知";
    },
    summary() {
      return this.notice.content || "";
    },
    timeText() {
      // 与打卡/公告一致：统一北京时间，不受设备时区影响
      return this.notice.created_at ? bjShortDateTime(this.notice.created_at) : "—";
    },
  },
  methods: {
    onTap() {
      if (this.notice.read) return;
      this.$emit("read", this.notice);
    },
  },
};
</script>
