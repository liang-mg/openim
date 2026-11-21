<template>
  <view class="mine-row flex items-center gap-3 py-3.5 border-b border-line" :class="{ 'border-b-0': last }" @tap="$emit('tap')">
    <view class="w-5.5 flex items-center justify-center">
      <app-icon :name="icon" :size="18" :color="tone === 'danger' ? 'var(--danger)' : 'var(--ink-2)'" />
    </view>
    <text class="flex-1 text-md" :class="tone === 'danger' ? 'text-danger' : 'text-ink'">{{ label }}</text>
    <text v-if="badge" class="text-2xs text-ink-3 mr-1">{{ badge }}</text>
    <app-icon name="chevron-right" :size="16" tone="ink-4" />
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";

/** 「我」页的一行入口（图标 + 文案 + 右箭头），danger 用于退出登录这类破坏性操作 */
export default {
  name: "MineRow",
  components: { AppIcon },
  props: {
    icon: { type: String, default: "settings" },
    label: { type: String, default: "" },
    badge: { type: String, default: "" },
    tone: { type: String, default: "default" },
    last: { type: Boolean, default: false },
  },
  emits: ["tap"],
};
</script>
