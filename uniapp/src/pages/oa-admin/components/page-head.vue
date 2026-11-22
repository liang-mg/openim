<template>
  <view class="flex items-center justify-between mb-2.5">
    <text class="flex-1 min-w-0 block text-xs text-ink-3">设置角色与直属上级，决定谁能看到谁的日报</text>
    <view class="flex items-center gap-1 px-3 py-1.5 rounded-ctl bg-brand" @tap="$emit('add')">
      <app-icon name="plus" :size="14" tone="card" />
      <text class="text-sm text-white">添加</text>
    </view>
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";

/**
 * 员工与权限页的说明条：一句角色可见范围说明 + 「添加」入口。
 * 标题与右上角身份在全局 page-header 里，这里不重复标题。
 * 只受控展示：点击抛 add，打开弹层与拉取 IM 候选账号由页面负责。
 * 保留「添加」文案：E2E verify-admin 用 getByText("添加", { exact: true }) 点入口。
 */
export default {
  name: "AdminPageHead",
  components: { AppIcon },
  emits: ["add"],
};
</script>
