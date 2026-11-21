<template>
  <view class="checkin-card flex flex-wrap items-center gap-3 rounded-card bg-brand-dark text-white p-3.5 mb-3.5" @tap="$emit('open')">
    <view class="checkin-card__main w-full">
      <view class="checkin-card__head flex items-baseline gap-2.5">
        <text class="checkin-card__label text-base opacity-90">今日打卡</text>
        <text class="checkin-card__tip text-xs opacity-75">{{ checkinTip }}</text>
        <view class="checkin-card__now ml-auto flex items-center gap-1 px-2 py-0.5 rounded-pill bg-white/20">
          <view class="checkin-card__dot w-1 h-1 rounded-full bg-ok" />
          <text class="checkin-card__now-text text-2xs text-white tabular-nums">现在 {{ nowClock }}</text>
        </view>
      </view>
      <view class="checkin-card__row mt-1.5 flex items-baseline gap-3 flex-wrap">
        <text class="checkin-card__time text-3xl font-semibold leading-none">{{ checkinTime }}</text>
        <text class="checkin-card__place text-xs opacity-80">{{ checkinPlace }}</text>
      </view>
    </view>

    <view class="checkin-card__photo flex-1 h-16 border border-dashed border-white/50 rounded-ctl flex flex-col items-center justify-center gap-1">
      <app-icon name="camera" :size="18" color="#ffffff" />
      <text class="checkin-card__photo-text text-xs opacity-80">{{ photoText }}</text>
    </view>
    <view class="checkin-card__btn flex-1 h-16 bg-white text-brand-dark rounded-ctl flex items-center justify-center text-md font-medium" @tap.stop="$emit('open')">
      <text>{{ checkin.btn_text }}</text>
    </view>
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";
import { bjHM } from "@/utils/beijing";

/**
 * 工作台顶部打卡卡：打卡时间 / 状态 / 地点 / 拍照打卡入口 + 两条操作按钮。
 *
 * 「现在 HH:mm」按北京时间走，时钟由卡片自己持有：页面不再持 timer，
 * 卡片挂载时开、卸载时清（只在分钟变化时改数据，避免每秒触发一次渲染）。
 */
export default {
  name: "CheckinCard",
  components: { AppIcon },
  props: {
    checkin: { type: Object, required: true },
  },
  emits: ["open"],
  data() {
    return {
      nowClock: bjHM(Date.now()),
      clockTimer: null,
    };
  },
  computed: {
    checkinTip() {
      return this.checkin.has_on ? `上班卡 · ${this.checkin.on_status || "已打卡"}` : "今天还没打上班卡";
    },
    checkinTime() {
      return this.checkin.has_on ? this.checkin.on_time : "未打卡";
    },
    checkinPlace() {
      return this.checkin.has_on
        ? `上班 ${this.checkin.on_time}${this.checkin.location ? ` · ${this.checkin.location}` : ""}`
        : "打卡后才能记录出勤";
    },
    photoText() {
      return this.checkin.has_on ? `下班 ${this.checkin.off_time || "未打"}` : "去拍照打卡";
    },
  },
  mounted() {
    this.clockTimer = setInterval(this.updateClock, 1000);
  },
  unmounted() {
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.clockTimer = null;
  },
  methods: {
    updateClock() {
      const next = bjHM(Date.now());
      if (next !== this.nowClock) this.nowClock = next;
    },
  },
};
</script>
