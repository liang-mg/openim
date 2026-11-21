<template>
  <bottom-sheet :open="open" :title="title" desc="处理意见会同步给申请人，请说明原因。" @close="$emit('close')">
    <view class="bg-fill rounded-ctl p-2.5 mb-3">
      <text class="block text-sm text-ink">{{ item.user_name }} · {{ item.title }}</text>
      <text v-if="item.subtitle" class="block mt-1 text-xs text-ink-3 leading-5">{{ item.subtitle }}</text>
    </view>

    <form-field label="处理意见" badge="必填" badge-tone="required">
      <textarea
        :value="modelValue"
        class="oa-textarea h-22"
        placeholder="请填写处理意见"
        placeholder-class="text-ink-4"
        maxlength="200"
        @input="$emit('update:modelValue', $event.detail.value)"
      />
    </form-field>

    <template #actions>
      <view class="oa-btn flex-1" @tap="$emit('close')"><text class="text-md text-ink">取消</text></view>
      <view class="oa-btn-primary flex-1" @tap="$emit('confirm')">
        <text class="text-md text-white font-medium">{{ busy ? "处理中…" : "确认" }}</text>
      </view>
    </template>
  </bottom-sheet>
</template>

<script>
import BottomSheet from "@/components/bottom-sheet.vue";
import FormField from "@/components/form-field.vue";

/**
 * 处理意见弹层（同意/拒绝/认定/忽略/申诉共用）。
 * 复用 bottom-sheet + form-field，样式全走 Tailwind 类，不再单独写 sheet 的 CSS。
 */
export default {
  name: "ActionSheet",
  components: { BottomSheet, FormField },
  props: {
    open: { type: Boolean, default: false },
    title: { type: String, default: "" },
    item: { type: Object, default: () => ({}) },
    modelValue: { type: String, default: "" },
    busy: { type: Boolean, default: false },
  },
  emits: ["close", "confirm", "update:modelValue"],
};
</script>
