<template>
  <view class="flex rounded-card bg-white py-3 mb-3">
    <view v-for="s in items" :key="s.label" class="flex-1 flex flex-col items-center gap-0.5">
      <text class="text-2xl font-semibold" :class="s.tone">{{ s.value }}</text>
      <text class="text-xs text-ink-3">{{ s.label }}</text>
    </view>
  </view>
</template>

<script>
/**
 * 我的出勤：四个统计数字。
 * 颜色语义固定（正常黑、迟到早退橙、缺卡红），页面不再逐格写 style。
 */
export default {
  name: "StatRow",
  props: {
    summary: { type: Object, default: () => ({}) },
  },
  computed: {
    items() {
      const s = this.summary || {};
      return [
        { label: "出勤天数", value: s.attend ?? 0, tone: "text-ink" },
        { label: "迟到次数", value: s.late ?? 0, tone: "text-warn" },
        { label: "早退次数", value: s.early ?? 0, tone: "text-warn" },
        { label: "缺卡天数", value: s.absent ?? 0, tone: "text-danger" },
      ];
    },
  },
};
</script>
