<template>
  <view class="st" :style="{ color: fg, background: bg }">
    <text class="st__text">{{ text }}</text>
  </view>
</template>

<script>
/**
 * 状态标签（小圆角、浅底深字）。
 *
 * 样式用 @apply 组合 Tailwind（见 <style>），色值仍来自语义 tone，
 * 这样「待审批」在审批/日报/考勤各处是同一套颜色，不会再各写一份。
 *
 * tone: pending | success | danger | info | muted | brand
 */
const TONES = {
  pending: { fg: "var(--warn-text)", bg: "var(--warn-soft)" },
  success: { fg: "var(--ok-text)", bg: "var(--ok-soft)" },
  danger: { fg: "var(--danger)", bg: "var(--danger-soft)" },
  info: { fg: "var(--primary)", bg: "var(--info-soft)" },
  muted: { fg: "var(--ink-3)", bg: "var(--fill-2)" },
  brand: { fg: "var(--brand)", bg: "var(--brand-soft)" },
};

export default {
  name: "StatusTag",
  props: {
    text: { type: String, default: "" },
    tone: { type: String, default: "muted" },
    color: { type: String, default: "" },
    background: { type: String, default: "" },
  },
  computed: {
    fg() {
      return this.color || (TONES[this.tone] || TONES.muted).fg;
    },
    bg() {
      return this.background || (TONES[this.tone] || TONES.muted).bg;
    },
  },
};
</script>

<style scoped>
.st {
  @apply inline-flex items-center h-4.5 px-1.5 rounded shrink-0;
}

.st__text {
  @apply text-2xs leading-none;
}
</style>
