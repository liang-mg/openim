<template>
  <view class="bg-white rounded-card p-4">
    <text class="block text-lg font-semibold mb-3.5">今日打卡</text>

    <view
      v-for="(row, i) in rows"
      :key="row.key"
      class="relative flex gap-3"
      :class="i === rows.length - 1 ? 'pb-0' : 'pb-[18px]'"
    >
      <view class="w-2.5 h-2.5 mt-1 rounded-pill shrink-0" :class="row.done ? 'bg-ok-text' : 'bg-[var(--line-2)]'" />
      <view class="flex-1 min-w-0">
        <view class="flex items-center gap-2">
          <text class="text-base text-[var(--ink-strong)]">{{ row.label }}</text>
          <text v-if="row.record" class="text-xs" :style="{ color: statusColor(row.record.status) }">{{ row.record.status_text }}</text>
          <text v-else class="text-xs text-[var(--sub-text)]">未打卡</text>
        </view>
        <view class="flex items-baseline gap-2 mt-0.5">
          <text class="text-[22px] font-semibold text-[var(--ink-strong)]">{{ fmtTime(row.record && row.record.checkin_time) }}</text>
          <text v-if="showOutFence(row.record)" class="text-xs text-[var(--warn-strong)]">范围外 {{ fmtDistance(row.record.distance) }}</text>
          <text v-if="row.record && row.record.photo_url" class="text-xs text-brand" @tap="$emit('open-photo', row.record)">查看照片</text>
        </view>
        <text v-if="placeText(row.record)" class="block mt-0.5 text-xs text-[var(--sub-text)]">{{ placeText(row.record) }}</text>
      </view>
    </view>
  </view>
</template>

<script>
import { fmtTime, fmtDistance, placeText, STATUS_COLOR } from "@/utils/checkin";

/**
 * 今日打卡记录：上班卡 / 下班卡两行（状态、时间、范围外提醒、地点、查看照片）。
 *
 * 纯展示组件：记录来自 props，点「查看照片」只抛 open-photo，
 * 换签名 URL 与 previewImage 由页面做（接口调用留在页面）。
 */
export default {
  name: "CheckinRecordList",
  props: {
    today: { type: Object, required: true },
  },
  emits: ["open-photo"],
  computed: {
    rows() {
      return [
        { key: "on", label: "上班卡", record: this.today.on, done: Boolean(this.today.on) },
        { key: "off", label: "下班卡", record: this.today.off, done: Boolean(this.today.off) },
      ];
    },
  },
  methods: {
    fmtTime,
    fmtDistance,
    placeText,
    statusColor(status) {
      return STATUS_COLOR[status] || "var(--sub-text)";
    },
    showOutFence(record) {
      return Boolean(record && record.fence_set && !record.in_fence && record.distance);
    },
  },
};
</script>
