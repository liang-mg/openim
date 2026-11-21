<template>
  <view class="mine-calendar oa-card">
    <text class="block text-xs text-ink-3 mb-2">{{ hasData ? "点日期查看当天明细" : "该月没有打卡记录" }}</text>

    <att-calendar
      :cells="cells"
      :by-date="byDate"
      :today-key="todayKey"
      :selected="selected"
      :has-data="hasData"
      :rule="rule"
      :leave-days="leaveDays"
      @select="$emit('select', $event)"
    />

    <view class="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-2.5 pt-2.5 border-t border-line">
      <view v-for="item in legend" :key="item.text" class="flex items-center gap-1">
        <view class="w-2 h-2 rounded-sm" :class="item.bg" />
        <text class="text-2xs text-ink-3">{{ item.text }}</text>
      </view>
    </view>
  </view>
</template>

<script>
import AttCalendar from "@/components/att-calendar.vue";

/** 图例：与 att-calendar 的 done / partial / absent / leave / rest 五种底色一一对应。
 *  请假用现有 ok 系浅绿（PC 的请假底色也只是略深一点的浅绿），不新增 hex；
 *  圆点颜色与「两次卡齐全」接近，格内「请假」文案负责区分。 */
const LEGEND = [
  { text: "两次卡齐全", bg: "bg-ok-soft" },
  { text: "缺一次卡", bg: "bg-warn-soft" },
  { text: "缺卡", bg: "bg-danger-soft" },
  { text: "已批准请假", bg: "bg-ok-soft" },
  { text: "周末 / 未到", bg: "bg-fill-2" },
];

/**
 * 我的出勤：月历卡（提示文案 + 月历 + 五色图例）。
 * 选中哪一天由页面持有，这里只透传 selected 并把点击回抛。
 */
export default {
  name: "MineCalendarCard",
  components: { AttCalendar },
  props: {
    cells: { type: Array, default: null },
    byDate: { type: Object, default: () => ({}) },
    todayKey: { type: String, default: "" },
    selected: { type: String, default: "" },
    hasData: { type: Boolean, default: false },
    rule: { type: Object, default: null },
    /** 已批准请假日 { "YYYY-MM-DD": true }，来自 /checkin/list 的 approved_leave_days */
    leaveDays: { type: Object, default: () => ({}) },
  },
  emits: ["select"],
  computed: {
    legend() {
      return LEGEND;
    },
  },
};
</script>
