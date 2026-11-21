<template>
  <view
    class="switch relative shrink-0 rounded-pill"
    :class="[small ? 'w-[34px] h-[19px]' : 'w-10 h-[22px]', on ? 'bg-brand' : 'bg-[var(--line-2)]']"
    @tap="$emit('change', !on)"
  >
    <view
      class="absolute top-[2px] left-[2px] rounded-pill bg-white transition-transform duration-150"
      :class="small ? 'w-[15px] h-[15px]' : 'w-[18px] h-[18px]'"
      :style="{ transform: on ? `translateX(${small ? 15 : 18}px)` : 'translateX(0)' }"
    />
  </view>
</template>

<script>
/**
 * 开关（考勤规则两项 / 「含已停用」 / 表单里的「管理员」）。
 *
 * 保留 .switch 类名：E2E 用 `.toolbar2 .switch` 定位「含已停用」开关。
 * 视觉与原来的 .switch/.switch--sm 一致（40×22 / 34×19，圆钮位移 18/15），
 * 只是改成 Tailwind 原子类，不再各页面复制一份 CSS。
 */
export default {
  name: "ToggleSwitch",
  props: {
    on: { type: Boolean, default: false },
    small: { type: Boolean, default: false },
  },
  emits: ["change"],
};
</script>
