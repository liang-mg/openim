<template>
  <view class="report-row rounded-card bg-white px-3 py-3 mb-2.5" :class="{ 'bg-fill': total }">
    <view class="flex items-baseline justify-between">
      <text class="text-md font-semibold text-ink">{{ title }}</text>
      <text class="text-base font-semibold" :style="{ color: rateColor }">{{ row.rate }}%</text>
    </view>

    <text v-if="!total" class="block mt-0.5 text-xs text-ink-3">
      {{ row.department || "未分配" }}{{ row.position ? ` · ${row.position}` : "" }}
    </text>

    <view class="grid grid-cols-6 gap-1 mt-2">
      <view v-for="c in cells" :key="c.label" class="flex flex-col items-center gap-0.5">
        <text class="text-md font-semibold" :class="c.tone">{{ c.value }}</text>
        <text class="text-2xs text-ink-4">{{ c.label }}</text>
      </view>
    </view>

    <text v-if="!total" class="block mt-1.5 text-2xs text-ink-4">
      平均 {{ row.avg_on || "—" }} 上班 · {{ row.avg_off || "—" }} 下班
    </text>
  </view>
</template>

<script>
/**
 * 出勤报表的一行（每人一张卡；total=true 时渲染合计卡）。
 * 六格统计与 PC 端列一致：应出勤/实际/迟到/早退/缺卡/单卡。
 */
export default {
  name: "ReportRow",
  props: {
    row: { type: Object, required: true },
    total: { type: Boolean, default: false },
  },
  computed: {
    title() {
      return this.total ? "合计" : this.row.name;
    },
    rateColor() {
      const rate = Number(this.row.rate) || 0;
      if (rate >= 90) return "var(--ok-text)";
      return rate >= 80 ? "var(--warn-strong)" : "var(--danger)";
    },
    cells() {
      const r = this.row;
      return [
        { label: "应出勤", value: r.workdays, tone: "text-ink" },
        { label: "实际", value: r.attend, tone: "text-ink" },
        { label: "迟到", value: r.late, tone: "text-warn" },
        { label: "早退", value: r.early, tone: "text-warn" },
        { label: "缺卡", value: r.absent, tone: "text-danger" },
        { label: "单卡", value: r.partial, tone: "text-warn" },
      ];
    },
  },
};
</script>
