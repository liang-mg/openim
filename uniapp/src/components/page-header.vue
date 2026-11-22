<template>
  <view class="ph" :class="{ 'ph--plain': !tone || tone === 'plain', 'ph--brand': tone === 'brand' }">
    <view class="ph__side ph__side--left" @tap="onBack">
      <view v-if="back" class="ph__back">
        <app-icon name="chevron-left" :size="22" :color="iconColor" />
      </view>
    </view>
    <view class="ph__main">
      <text class="ph__title">{{ title }}</text>
      <text v-if="subtitle" class="ph__subtitle">{{ subtitle }}</text>
    </view>
    <view class="ph__side ph__side--right">
      <slot name="right" />
    </view>
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";

/**
 * 通用页头（sticky）。
 *
 * 原来 8 个页面各写一份 `.xxx-topbar` + 返回箭头字符「‹」，导致：
 *   - 返回箭头是文本字符，不同设备字形/居中不一致（PC 端是图标）；
 *   - 高度、内边距、标题字号各页略有出入。
 * 统一到这里：52px 高、sticky、左中右三栏，右侧用 slot 放按钮。
 *
 * tone="brand" 蓝底白字（工作台/消息/审批/出勤等主色页头）
 * tone="plain" 白底黑字（我的/聊天等）
 */
export default {
  name: "PageHeader",
  components: { AppIcon },
  props: {
    title: { type: String, default: "" },
    subtitle: { type: String, default: "" },
    tone: { type: String, default: "brand" },
    back: { type: Boolean, default: true },
  },
  emits: ["back"],
  computed: {
    iconColor() {
      return this.tone === "brand" ? "#ffffff" : "var(--ink)";
    },
  },
  methods: {
    onBack() {
      if (!this.back) return;
      this.$emit("back");
      // 默认行为：有上一页就返回，否则回工作台。页面可监听 back 覆盖。
      const pages = getCurrentPages();
      if (pages.length > 1) uni.navigateBack();
      else uni.switchTab({ url: "/pages/work/index" });
    },
  },
};
</script>

<style scoped>
/* 样式用 Tailwind @apply 组合（间距/对齐/颜色都来自主题），不再逐条写 px */
.ph {
  @apply sticky top-0 z-10 flex items-center px-2 shrink-0;
  height: calc(52px + var(--status-bar-height, 0px));
  padding-top: var(--status-bar-height, 0px);
}

.ph--brand {
  @apply bg-brand text-white;
}

.ph--plain {
  @apply bg-white text-ink border-b border-line;
}

.ph__side {
  @apply flex items-center min-w-10;
}

.ph__side--left {
  @apply justify-start;
}

.ph__side--right {
  @apply justify-end gap-3;
}

.ph__back {
  @apply w-9 h-9 flex items-center justify-center;
}

.ph__main {
  @apply flex-1 min-w-0 flex flex-col items-center justify-center;
}

.ph__title {
  @apply text-lg font-semibold max-w-60 overflow-hidden whitespace-nowrap;
  text-overflow: ellipsis;
}

.ph__subtitle {
  @apply text-2xs opacity-85 mt-px;
}
</style>
