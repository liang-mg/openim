<template>
  <view class="arow oa-card flex items-center gap-2.5" @tap="$emit('open', announcement)">
    <view class="arow__main flex-1 min-w-0">
      <view class="arow__head flex items-center gap-1.5">
        <text class="arow__title block flex-1 min-w-0 text-md font-semibold text-ink truncate">{{ announcement.title }}</text>
        <view v-if="hasUnread" class="arow__dot w-2 h-2 rounded-full bg-brand shrink-0" />
        <app-icon name="chevron-right" :size="16" color="var(--ink-4)" />
      </view>
      <text class="arow__meta block mt-1 text-xs text-ink-3 truncate">{{ publisherText }} · {{ scopeText }}</text>
      <view class="arow__foot flex items-center justify-between gap-2 mt-0.5">
        <text class="arow__time text-2xs text-ink-4">{{ timeText }}</text>
        <text class="arow__read text-2xs" :class="hasUnread ? 'text-brand' : 'text-ink-4'">已读 {{ readCount }}/{{ recipientCount }}</text>
      </view>
    </view>
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";
import { bjShortDateTime } from "@/utils/beijing";

/**
 * 公告列表的一行：标题 / 发布人·范围 / 发布时间（北京时间）/ 未读回执点 / 已读进度。
 *
 * 「未读点」= 还有收件人未读（read_count < recipient_count）。列表接口
 * getPublishedAnnouncements 给的是发布记录汇总，不含「当前账号」的阅读状态，
 * 所以这个点表达的是「回执未齐」，不是「我没读」；点开详情后会自动写本人的阅读回执。
 */
export default {
  name: "AnnouncementRow",
  components: { AppIcon },
  props: {
    announcement: { type: Object, required: true },
  },
  emits: ["open"],
  computed: {
    publisherText() {
      return this.announcement.publisher_name || "—";
    },
    /** 全公司公告没有部门，按范围文案兜底，避免 meta 行出现空段 */
    scopeText() {
      if (this.announcement.scope === "department") return this.announcement.department_name || "指定部门";
      return "全公司";
    },
    timeText() {
      const ts = this.announcement.published_at;
      // 设备时区可能是别的，统一走北京时间（与 PC 端一致）
      return ts ? bjShortDateTime(ts) : "—";
    },
    recipientCount() {
      return Number(this.announcement.recipient_count) || 0;
    },
    readCount() {
      return Number(this.announcement.read_count) || 0;
    },
    hasUnread() {
      return this.recipientCount > 0 && this.readCount < this.recipientCount;
    },
  },
};
</script>
