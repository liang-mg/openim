<template>
  <view class="row oa-card flex items-center gap-2.5" @tap="$emit('open', report)">
    <oim-avatar :text="avatarText" :size="38" />
    <view class="row__main flex-1 min-w-0">
      <view class="row__head flex items-center justify-between gap-2">
        <text class="row__name text-md font-semibold text-ink">{{ report.author.name }}</text>
        <status-tag :text="statusText" :tone="statusTone" />
      </view>
      <text class="row__meta block mt-1 text-xs text-ink-3">{{ report.author.department }} · {{ typeText }} · 全文约 {{ words }} 字</text>
      <text class="row__period block mt-0.5 text-2xs text-ink-4">{{ report.period }}</text>
    </view>
    <app-icon name="chevron-right" :size="16" color="var(--ink-4)" />
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";
import StatusTag from "@/components/status-tag.vue";
import OimAvatar from "@/components/oim-avatar.vue";
import { reportTypeText } from "@/api/oa";

/**
 * 报告查阅列表的一行（头像 / 姓名 / 部门 / 类型 / 字数 / 周期 / 状态 / 箭头）。
 *
 * 状态文案由页面按角色给出（组长「待点评」、领导「待查阅」），
 * 类型文案与字数是纯展示计算，收在组件里，页面不再逐个拼字符串。
 */
export default {
  name: "ReviewRow",
  components: { AppIcon, StatusTag, OimAvatar },
  props: {
    report: { type: Object, required: true },
    statusText: { type: String, default: "" },
    statusTone: { type: String, default: "brand" },
  },
  emits: ["open"],
  computed: {
    avatarText() {
      return (this.report.author.name || "?").slice(0, 1);
    },
    typeText() {
      return reportTypeText(this.report.type);
    },
    words() {
      const c = this.report.content || {};
      return (c.done || "").length + (c.plan || "").length + (c.issues || "").length;
    },
  },
};
</script>
