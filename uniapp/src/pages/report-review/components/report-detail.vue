<template>
  <view class="report-detail">
    <!-- 作者信息 -->
    <view class="dhead oa-card flex items-center gap-2.5">
      <oim-avatar :text="avatarText" :size="44" />
      <view class="dhead__info flex-1 min-w-0">
        <view class="dhead__name-row flex items-baseline gap-1.5">
          <text class="dhead__name text-lg font-semibold text-ink">{{ report.author.name }}</text>
          <text class="dhead__dept text-xs text-ink-3">{{ report.author.department }}</text>
        </view>
        <text class="dhead__meta block mt-0.5 text-2xs text-ink-4 leading-relaxed">{{ report.period }} {{ typeText }} · 提交于 {{ timeText }} · 约 {{ words }} 字</text>
      </view>
      <status-tag :text="headStatus" :tone="report.status === 'archived' ? 'success' : 'brand'" />
    </view>

    <!-- 三段内容 -->
    <view class="oa-card">
      <view
        v-for="(s, i) in sections"
        :key="s.key"
        class="section mb-3"
        :class="{ 'mb-0': i === sections.length - 1 }"
      >
        <view class="section__head flex items-center gap-1.5 mb-1">
          <app-icon :name="s.icon" :size="15" color="var(--ink-2)" />
          <text class="section__title text-sm text-ink-2">{{ s.title }}</text>
        </view>
        <text class="section__text block text-md text-ink leading-relaxed whitespace-pre-wrap">{{ s.text || "—" }}</text>
      </view>
    </view>

    <!-- 组长 / 领导点评 -->
    <view v-for="q in quotes" :key="q.key" class="oa-card quote">
      <text class="quote__title block text-sm text-ink-2 mb-1.5">{{ q.title }}</text>
      <text class="quote__text block text-base text-ink leading-relaxed pl-2.5 border-l-4 border-solid border-brand-soft">{{ q.review.comment }}</text>
      <text class="quote__author block mt-1.5 text-2xs text-ink-4 text-right">{{ q.review.reviewer_name }} · {{ q.role }} · {{ q.review.review_time }}</text>
    </view>

    <!-- 附件 -->
    <view class="oa-card attach">
      <text class="attach__title block text-sm text-ink-2 mb-1.5">附件 {{ attachments.length }}</text>
      <text v-if="!attachments.length" class="attach__none text-sm text-ink-4">无附件</text>
      <view v-for="(a, i) in attachments" :key="i" class="arow flex items-center gap-2 py-2 border-t border-solid border-line">
        <app-icon :name="isImage(a.file_type) ? 'image' : 'document'" :size="16" color="var(--ink-3)" />
        <text class="arow__name flex-1 min-w-0 text-sm text-ink overflow-hidden whitespace-nowrap" style="text-overflow: ellipsis">{{ a.name }}</text>
        <text class="arow__size text-2xs text-ink-4">{{ sizeText(a.size) }}</text>
        <text class="arow__download text-xs text-brand pl-1.5" @tap="$emit('download', { url: a.url, name: a.name })">下载</text>
      </view>
    </view>

    <!-- 归档提示 / 点评入口（能否点评由服务端 review_actions 决定） -->
    <view v-if="report.status === 'archived'" class="archived rounded-ctl bg-ok-soft p-3">
      <text class="archived__text text-sm text-ok-text leading-relaxed">该日报已归档，审阅流程结束，内容与点评均不可再修改。</text>
    </view>
    <comment-box v-else-if="actions.can_comment !== false" :actions="actions" :submitting="submitting" @submit="$emit('submit', $event)" />
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";
import StatusTag from "@/components/status-tag.vue";
import OimAvatar from "@/components/oim-avatar.vue";
import CommentBox from "./comment-box.vue";
import { reportTypeText, formatFileSize } from "@/api/oa";
import { bjHM } from "@/utils/beijing";

/**
 * 报告详情卡片：作者信息、三段内容、附件、组长/领导点评、归档提示、点评入口。
 *
 * 纯展示组件：数据由页面查好传进来，下载附件与提交点评只用事件抛给页面，
 * 组件自己不调接口，便于单独改版式。
 */
export default {
  name: "ReportDetail",
  components: { AppIcon, StatusTag, OimAvatar, CommentBox },
  props: {
    report: { type: Object, required: true },
    managerReview: { type: Object, default: null },
    leaderReview: { type: Object, default: null },
    /** 服务端下发的可执行动作：{ can_comment, can_escalate, can_archive } */
    actions: { type: Object, default: () => ({}) },
    submitting: { type: Boolean, default: false },
  },
  emits: ["submit", "download"],
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
    timeText() {
      const ts = this.report.submit_time;
      if (!ts) return "—";
      // 北京时间（设备时区可能是别的）
      return bjHM(ts);
    },
    headStatus() {
      if (this.report.status === "archived") return "已归档";
      if (this.report.status === "pending_leader") return "待领导查阅";
      return "待组长查阅";
    },
    sections() {
      const content = this.report.content || {};
      return [
        { key: "done", icon: "check", title: "今日完成", text: content.done },
        { key: "plan", icon: "calendar", title: "明日计划", text: content.plan },
        { key: "issues", icon: "warning", title: "遇到问题", text: content.issues },
      ];
    },
    quotes() {
      const list = [];
      if (this.managerReview) list.push({ key: "manager", title: "组长点评", role: "组长", review: this.managerReview });
      if (this.leaderReview) list.push({ key: "leader", title: "领导点评", role: "领导", review: this.leaderReview });
      return list;
    },
    attachments() {
      return this.report.attachments || [];
    },
  },
  methods: {
    isImage(ext) {
      return ["jpg", "jpeg", "png", "gif", "webp"].includes(String(ext || "").toLowerCase());
    },
    sizeText(size) {
      return formatFileSize(size);
    },
  },
};
</script>
