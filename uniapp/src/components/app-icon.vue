<template>
  <view class="icon" :style="boxStyle" aria-hidden="true">
    <image class="icon__image" :src="iconSrc" mode="aspectFit" :style="boxStyle" />
  </view>
</template>

<script>
/**
 * App/H5 共用图片图标。
 *
 * H5 与不同 Android System WebView 对私有区 iconfont 的加载行为并不完全一致，
 * 字体未命中时会显示成方框。这里使用构建前生成的透明 PNG，只依赖 uni-app
 * 最基础的 image 组件；现有 name / size / color / tone 接口保持不变。
 */
const ICON_NAMES = new Set([
  "camera", "document", "clock", "calendar", "video", "check", "check-square",
  "user", "users", "settings", "logout", "shield", "bell", "chevron-right",
  "chevron-left", "plus", "search", "warning", "image", "download", "trash",
  "edit", "send", "close", "more", "message", "list", "chart", "refresh",
  "filter", "location", "paperclip",
]);

const colorVariant = (tone, color) => {
  const value = `${tone || ""} ${color || ""}`.toLowerCase();
  if (/card|white|ffffff|#fff\b/.test(value)) return "white";
  if (/danger|e34d59|red/.test(value)) return "danger";
  if (/ok|success|12a870|22a06b|green/.test(value)) return "ok";
  if (/warn|f5a623|d97706|a56500|c2410c|orange/.test(value)) return "warn";
  if (/brand|primary|0b5fd8|0089ff|3b5bdb|blue/.test(value)) return "brand";
  if (/ink-3|ink-4|sub-text|8a9099|b6bcc6|muted/.test(value)) return "muted";
  return "ink";
};

export default {
  name: "AppIcon",
  props: {
    name: { type: String, required: true },
    size: { type: [Number, String], default: 20 },
    color: { type: String, default: "currentColor" },
    tone: { type: String, default: "" },
    // 保留旧参数，避免已有调用失效；图片图标不需要描边宽度。
    strokeWidth: { type: [Number, String], default: 1.6 },
  },
  computed: {
    safeName() {
      return ICON_NAMES.has(this.name) ? this.name : "more";
    },
    variant() {
      return colorVariant(this.tone, this.color);
    },
    iconSrc() {
      return `/static/icons/${this.variant}/${this.safeName}.png`;
    },
    boxStyle() {
      return { width: `${this.size}px`, height: `${this.size}px` };
    },
  },
};
</script>

<style scoped>
.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  line-height: 0;
}

.icon__image {
  display: block;
}
</style>
