<template>
  <view class="team-summary oa-card flex">
    <view v-for="item in items" :key="item.label" class="flex-1 flex flex-col items-center gap-0.5">
      <text class="text-xl font-semibold" :class="item.tone">{{ item.value }}</text>
      <text class="text-2xs text-ink-3">{{ item.label }}</text>
    </view>
  </view>
</template>

<script>
/**
 * 团队出勤：成员 / 已到 / 未到 / 迟到 / 早退 五个汇总数字。
 * 颜色语义固定（未到红、迟到早退橙），页面不再逐格写 style。
 */
export default {
  name: "TeamSummary",
  props: {
    summary: { type: Object, default: () => ({}) },
  },
  computed: {
    items() {
      const s = this.summary || {};
      return [
        { label: "成员", value: s.members ?? 0, tone: "text-ink" },
        { label: "已到", value: s.present ?? 0, tone: "text-ink" },
        { label: "未到", value: s.absent ?? 0, tone: "text-danger" },
        { label: "迟到", value: s.late ?? 0, tone: "text-warn-text" },
        { label: "早退", value: s.early ?? 0, tone: "text-warn-text" },
      ];
    },
  },
};
</script>
