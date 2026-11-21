<template>
  <view class="flex gap-2.5 mb-3">
    <view
      class="submit__btn flex-1 h-12 rounded-[10px] bg-brand flex items-center justify-center"
      :class="{ 'opacity-45': !!today.on || submitting }"
      @tap="$emit('submit', 'on')"
    >
      <text class="submit__text text-lg font-medium text-white">{{ today.on ? "上班已打卡" : "提交上班卡" }}</text>
    </view>
    <view
      class="submit__btn submit__btn--ghost flex-1 h-12 rounded-[10px] bg-white border border-solid border-line flex items-center justify-center"
      :class="{ 'opacity-45': !today.on || !!today.off || submitting }"
      @tap="$emit('submit', 'off')"
    >
      <text class="submit__text submit__text--ghost text-lg font-medium text-ink">{{ today.off ? "下班已打卡" : "提交下班卡" }}</text>
    </view>
  </view>
</template>

<script>
/**
 * 提交区：上班卡 / 下班卡两个按钮（按钮文案即状态提示）。
 *
 * 只渲染 today/submitting 推导出的状态并抛 submit(type)，校验与接口调用留在页面 doCheckin。
 * 保留 .submit__btn / .submit__text 类名：E2E 用它们点按钮、断言「已打卡」文案与禁用态。
 */
export default {
  name: "CheckinSubmitBar",
  props: {
    today: { type: Object, required: true },
    submitting: { type: Boolean, default: false },
  },
  emits: ["submit"],
};
</script>
