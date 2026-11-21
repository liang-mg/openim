<template>
  <view class="oa-card">
    <view class="flex items-baseline justify-between">
      <text class="text-lg font-semibold text-ink">本周提交</text>
      <text class="text-sm text-ink-2">{{ submitted }} / {{ required }} 天</text>
    </view>

    <view class="h-1.5 rounded-pill bg-fill-2 mt-2.5 mb-2 overflow-hidden">
      <view class="h-full rounded-pill bg-brand" :style="{ width: percent + '%' }" />
    </view>

    <view class="flex items-center gap-1.5">
      <app-icon name="check" :size="14" tone="warn" />
      <text class="text-xs text-ink-3">连续 {{ streak }} 天 · 保持住</text>
    </view>
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";

/** 日报「本周提交」进度卡 */
export default {
  name: "WeekProgress",
  components: { AppIcon },
  props: {
    submitted: { type: Number, default: 0 },
    required: { type: Number, default: 5 },
    streak: { type: Number, default: 0 },
  },
  computed: {
    percent() {
      const need = this.required || 5;
      return Math.min(100, Math.round((this.submitted / need) * 100));
    },
  },
};
</script>
