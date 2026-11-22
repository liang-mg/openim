<template>
  <view
    class="composer flex items-center gap-2 px-3 pt-2 bg-white border-t border-line shrink-0"
    style="padding-bottom: calc(8px + env(safe-area-inset-bottom))"
  >
    <input
      :value="modelValue"
      class="composer__input flex-1 h-[38px] px-3 rounded-ctl bg-fill-2 text-md"
      :placeholder="hint"
      placeholder-class="text-ink-4"
      confirm-type="send"
      :disabled="disabled || readOnly"
      :adjust-position="false"
      :cursor-spacing="0"
      @input="$emit('update:modelValue', $event.detail.value)"
      @confirm="$emit('send')"
      @focus="$emit('focus')"
      @blur="$emit('blur')"
    />
    <view
      class="composer__send w-[60px] h-[38px] rounded-ctl bg-brand flex items-center justify-center shrink-0"
      :class="{ 'opacity-50': !canSend }"
      @tap="$emit('send')"
    >
      <text class="text-md text-white">{{ readOnly ? "只读" : "发送" }}</text>
    </view>
  </view>
</template>

<script>
/**
 * 底部输入区：输入框 + 发送按钮。
 *
 * 只负责展示与事件，不做业务判断：空消息拦截、IM 未连接提示、只读模式 toast
 * 都在页面 send() 里统一处理（否则同一段提示会在两处漂移）。
 */
export default {
  name: "ChatComposer",
  props: {
    modelValue: { type: String, default: "" },
    /** IM 未连接：输入框禁用 */
    disabled: { type: Boolean, default: false },
    /** 只读态（保留能力，当前聊天页不再使用） */
    readOnly: { type: Boolean, default: false },
    hint: { type: String, default: "" },
  },
  emits: ["update:modelValue", "send", "focus", "blur"],
  computed: {
    canSend() {
      return !this.disabled && !this.readOnly && Boolean(this.modelValue.trim());
    },
  },
};
</script>
