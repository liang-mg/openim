<template>
  <view class="day-detail oa-card">
    <view class="flex items-baseline justify-between mb-2.5">
      <text class="text-md font-semibold text-ink">{{ dateText }}</text>
      <status-tag :text="stateText" :tone="stateTone" />
    </view>

    <view v-if="hint" class="mb-2 px-2 py-1.5 rounded-ctl bg-ok-soft">
      <text class="text-xs text-ok-text leading-relaxed">{{ hint }}</text>
    </view>

    <view v-for="row in rows" :key="row.label" class="flex items-center gap-2 py-2.5 border-t border-line">
      <text class="w-8 text-sm text-ink-3">{{ row.label }}</text>
      <text class="text-xl font-semibold text-ink">{{ row.time }}</text>
      <text v-if="row.miss" class="text-xs text-ink-4">未打卡</text>
      <text v-else class="text-xs" :class="row.tone">{{ row.status }}</text>
      <text class="flex-1 min-w-0 text-right text-2xs text-ink-4 truncate">{{ row.place }}</text>
    </view>

    <view class="flex items-center gap-3 mt-2">
      <text v-if="photo" class="text-sm text-brand" @tap="$emit('photo')">查看照片</text>
      <text v-if="outFence" class="text-xs text-warn-text">{{ outFence }}</text>
      <text class="ml-auto text-sm text-brand" @tap="$emit('goto')">去拍照打卡 →</text>
    </view>
  </view>
</template>

<script>
import StatusTag from "@/components/status-tag.vue";

/**
 * 选中日期的明细卡：日期 + 状态标签、请假提示、上班/下班两行、未打卡、地点、照片与去打卡入口。
 *
 * rows 与 hint 由页面（derived.js）格式化好再传：{ label, time, status, tone, place, miss } / string。
 * 组件不引 utils/checkin —— 状态判定的唯一入口留在页面侧，避免两处口径分叉。
 */
export default {
  name: "DayDetail",
  components: { StatusTag },
  props: {
    dateText: { type: String, default: "" },
    stateText: { type: String, default: "" },
    stateTone: { type: String, default: "muted" },
    /** 补充提示（如「当日为已批准请假，不计缺卡」），空串不渲染 */
    hint: { type: String, default: "" },
    rows: { type: Array, default: () => [] },
    /** 有照片的记录（非空才显示「查看照片」），页面拿它去换签名地址 */
    photo: { type: Object, default: null },
    /** 范围外距离文案，例如「范围外 120 米」 */
    outFence: { type: String, default: "" },
  },
  emits: ["photo", "goto"],
};
</script>
