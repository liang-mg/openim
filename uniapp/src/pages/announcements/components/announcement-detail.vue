<template>
  <view class="ad">
    <!-- 正文 -->
    <view class="oa-card">
      <view class="ad__head flex items-start gap-2">
        <app-icon name="bell" :size="18" color="var(--brand)" />
        <text class="ad__title block flex-1 min-w-0 text-xl font-semibold text-ink leading-snug">{{ announcement.title }}</text>
        <status-tag :text="scopeText" tone="brand" />
      </view>
      <text class="ad__meta block mt-2 text-xs text-ink-3">{{ publisherText }} · 发布于 {{ timeText }}</text>
      <view class="oa-divider" />
      <!-- pre-wrap 保留后端正文里的换行；break-words 防止长链接撑破卡片 -->
      <text class="ad__content block text-md text-ink leading-relaxed whitespace-pre-wrap break-words">{{ contentText }}</text>
    </view>

    <!-- 阅读回执（只读：无催办 / 无发布 / 无编辑） -->
    <view v-if="receipts" class="oa-card">
      <view class="ad__receipt-head flex items-center justify-between gap-2">
        <text class="text-md font-semibold text-ink">阅读回执</text>
        <text class="ad__progress text-xs" :class="unreadCount ? 'text-brand' : 'text-ok-text'">
          已读 {{ readCount }} / {{ recipientCount }}
        </text>
      </view>
      <view class="oa-divider" />

      <empty-state v-if="!rows.length" text="暂无收件人" inline />
      <view v-else>
        <view v-for="(row, i) in rows" :key="row.user_id" class="ad__row flex items-center gap-2 py-2" :class="{ 'border-t border-solid border-line': i > 0 }">
          <text class="ad__name block flex-1 min-w-0 text-sm text-ink truncate">{{ row.name }}</text>
          <text class="ad__read-time text-2xs text-ink-4">{{ row.read_at ? readTime(row.read_at) : "—" }}</text>
          <status-tag :text="row.read_at ? '已读' : '未读'" :tone="row.read_at ? 'success' : 'muted'" />
        </view>
        <text v-if="hiddenCount > 0" class="ad__more block pt-1.5 text-2xs text-ink-4 leading-relaxed">
          仅展示前 {{ maxRows }} 位收件人，其余 {{ hiddenCount }} 位请到 PC 管理端查看。
        </text>
      </view>
    </view>
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";
import EmptyState from "@/components/empty-state.vue";
import StatusTag from "@/components/status-tag.vue";
import { bjDateTime, bjShortDateTime } from "@/utils/beijing";

/** 回执最多平铺多少行（手机上一屏放不下全部收件人，明细回 PC 管理端看） */
const MAX_ROWS = 10;

/**
 * 公告详情卡片：标题 / 发布信息 / 正文 / 只读阅读回执。
 *
 * 纯展示组件：数据由页面查好传进来，组件自己不调接口，也不提供任何管理动作
 * （发布、编辑、删除、催办都不在这里做）。
 * 正文用 whitespace-pre-wrap 保留换行（与 PC 端 .article p 的 pre-wrap 一致）。
 */
export default {
  name: "AnnouncementDetail",
  components: { AppIcon, EmptyState, StatusTag },
  props: {
    announcement: { type: Object, required: true },
    /** 管理端回执汇总（getAnnouncementReceipts）；无权查看时为 null，整块不渲染 */
    receipts: { type: Object, default: null },
  },
  data() {
    return { maxRows: MAX_ROWS };
  },
  computed: {
    contentText() {
      return this.announcement.content || "（无正文）";
    },
    publisherText() {
      return this.announcement.publisher_name || "—";
    },
    scopeText() {
      if (this.announcement.scope === "department") return this.announcement.department_name || "指定部门";
      return "全公司";
    },
    timeText() {
      const ts = this.announcement.published_at;
      // 发布信息给到分钟、用完整日期，避免跨年公告只看到「MM-DD」
      return ts ? bjDateTime(ts) : "—";
    },
    recipients() {
      return (this.receipts && this.receipts.recipients) || [];
    },
    rows() {
      return this.recipients.slice(0, MAX_ROWS);
    },
    hiddenCount() {
      return Math.max(this.recipients.length - MAX_ROWS, 0);
    },
    recipientCount() {
      return Number(this.receipts && this.receipts.recipient_count) || 0;
    },
    readCount() {
      return Number(this.receipts && this.receipts.read_count) || 0;
    },
    unreadCount() {
      return Math.max(this.recipientCount - this.readCount, 0);
    },
  },
  methods: {
    readTime(ts) {
      return bjShortDateTime(ts);
    },
  },
};
</script>
