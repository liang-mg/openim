<template>
  <view class="flex flex-col items-center justify-center gap-2.5" :class="inline ? 'py-2.5' : 'px-5 py-11'">
    <view v-if="name" class="leading-none">
      <app-icon :name="name" :size="iconSize" tone="ink-4" />
    </view>
    <text class="text-sm text-ink-4 text-center leading-relaxed">{{ text }}</text>
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";

/**
 * 空态 / 占位。
 *
 * 样式全部走 Tailwind 原子类（不再单独写 .es__xxx 的 CSS）：
 * 需要微调时改类名即可，不必在三个页面里各改一遍 padding。
 */
export default {
  name: "EmptyState",
  components: { AppIcon },
  props: {
    text: { type: String, default: "暂无数据" },
    name: { type: String, default: "" },
    inline: { type: Boolean, default: false },
    iconSize: { type: [Number, String], default: 40 },
  },
};
</script>
