<template>
  <view class="mb-3.5">
    <view class="flex items-center gap-1.5 mb-1.5">
      <app-icon :name="icon" :size="15" tone="ink-2" />
      <text class="text-base font-medium text-ink">{{ label }}</text>
      <text v-if="locked" class="text-2xs text-ink-3 bg-fill-2 rounded px-1.5 py-px">只读</text>
      <text v-else-if="optional" class="text-2xs text-ink-3 bg-fill-2 rounded px-1.5 py-px">选填</text>
      <text v-else-if="!modelValue" class="text-2xs text-danger bg-danger-soft rounded px-1.5 py-px">必填</text>
      <text class="ml-auto text-2xs text-ink-4">{{ modelValue.length }} / {{ max }}</text>
    </view>

    <textarea
      :value="modelValue"
      class="w-full min-h-22 px-3 py-2.5 rounded-ctl border border-line text-md text-ink leading-relaxed"
      :class="locked ? 'bg-white' : 'bg-fill'"
      :maxlength="max"
      :disabled="locked"
      :placeholder="locked ? '暂无内容' : placeholder"
      placeholder-class="text-ink-4"
      auto-height
      @input="$emit('update:modelValue', $event.detail.value)"
    />
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";

/**
 * 日报的一个输入块（今日完成 / 明日计划 / 遇到问题）。
 * 拆出来之后页面只写 v-for，字段规则（只读/选填/必填/字数）都在这里统一。
 */
export default {
  name: "ReportField",
  components: { AppIcon },
  props: {
    label: { type: String, default: "" },
    icon: { type: String, default: "check" },
    modelValue: { type: String, default: "" },
    placeholder: { type: String, default: "" },
    optional: { type: Boolean, default: false },
    locked: { type: Boolean, default: false },
    max: { type: Number, default: 800 },
  },
  emits: ["update:modelValue"],
};
</script>
