<template>
  <view class="oa-card">
    <view class="flex items-baseline justify-between">
      <text class="text-md font-semibold text-ink">{{ row.department }}</text>
      <text class="text-base font-semibold" :style="{ color: rateColor }">{{ row.rate }}%</text>
    </view>
    <text class="block mt-1 text-xs text-ink-3">应提交 {{ row.total }} · 已提交 {{ row.submitted }}</text>
    <view v-if="row.missing && row.missing.length" class="flex flex-wrap gap-1.5 mt-2">
      <text v-for="n in row.missing" :key="n" class="text-2xs text-ink-2 bg-fill-2 rounded px-1.5 py-0.5">{{ n }}</text>
    </view>
    <text v-else class="block mt-1.5 text-xs text-ok-text">全部已提交</text>
  </view>
</template>

<script>
/**
 * 日报提交率卡片（按部门一行）。
 * 阈值 80% 与 PC 端一致：>=80 绿，否则红。
 */
export default {
  name: "RateCard",
  props: {
    row: { type: Object, required: true },
  },
  computed: {
    rateColor() {
      return Number(this.row.rate) >= 80 ? "var(--ok-text)" : "var(--danger)";
    },
  },
};
</script>
