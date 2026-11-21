<template>
  <bottom-sheet :open="open" :title="title" @close="$emit('close')">
    <view class="flex flex-wrap gap-2 mb-2">
      <text v-for="s in stats" :key="s.label" class="text-xs text-ink-2 bg-fill-2 rounded px-2 py-1">
        {{ s.label }} {{ s.value }}
      </text>
    </view>

    <skeleton v-if="loading" :lines="4" :height="52" radius="8px" />
    <att-calendar
      v-else
      :month="month"
      :by-date="byDate"
      :today-key="todayKey"
      :has-data="hasData"
      :rule="rule"
      :leave-days="leaveDays"
      compact
    />
  </bottom-sheet>
</template>

<script>
import BottomSheet from "@/components/bottom-sheet.vue";
import Skeleton from "@/components/skeleton.vue";
import AttCalendar from "@/components/att-calendar.vue";

/** 团队出勤：某个成员的月历抽屉（复用 bottom-sheet，不再自己写遮罩） */
export default {
  name: "MemberSheet",
  components: { BottomSheet, Skeleton, AttCalendar },
  props: {
    open: { type: Boolean, default: false },
    name: { type: String, default: "" },
    monthText: { type: String, default: "" },
    month: { type: String, default: "" },
    byDate: { type: Object, default: () => ({}) },
    todayKey: { type: String, default: "" },
    hasData: { type: Boolean, default: false },
    rule: { type: Object, default: () => ({}) },
    /** 已批准请假日 { "YYYY-MM-DD": true }，来自 /checkin/team/:id 的 approved_leave_days */
    leaveDays: { type: Object, default: () => ({}) },
    monthStats: { type: Object, default: () => ({}) },
    loading: { type: Boolean, default: false },
  },
  emits: ["close"],
  computed: {
    title() {
      return [this.name, this.monthText].filter(Boolean).join(" · ");
    },
    stats() {
      const m = this.monthStats || {};
      return [
        { label: "出勤", value: m.attend ?? 0 },
        { label: "迟到", value: m.late ?? 0 },
        { label: "早退", value: m.early ?? 0 },
        { label: "缺卡", value: m.absent ?? 0 },
        { label: "单卡", value: m.partial ?? 0 },
      ];
    },
  },
};
</script>
