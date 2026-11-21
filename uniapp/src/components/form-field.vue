<template>
  <view class="ff">
    <view class="ff__head">
      <text class="ff__label">{{ label }}</text>
      <text v-if="badge" class="ff__badge" :class="badgeClass">{{ badge }}</text>
    </view>
    <slot />
    <text v-if="hint" class="ff__hint">{{ hint }}</text>
  </view>
</template>

<script>
/**
 * 表单项外壳：标签 + 控件 + 提示。
 *
 * 原来（请假/补卡、员工编辑、审批意见）三处各写一套 `.form/.form__label/.form__input`，
 * padding、圆角、字号都有出入。这里统一外壳，控件用默认插槽放 input/picker/textarea。
 *
 * 用法：
 *   <form-field label="事由" hint="最多 200 字">
 *     <textarea class="ff-input" ... />
 *   </form-field>
 */
export default {
  name: "FormField",
  props: {
    label: { type: String, default: "" },
    hint: { type: String, default: "" },
    badge: { type: String, default: "" },
    badgeTone: { type: String, default: "muted" },
  },
  computed: {
    badgeClass() {
      return `ff__badge--${this.badgeTone}`;
    },
  },
};
</script>

<style scoped>
.ff {
  margin-bottom: 12px;
}

.ff__head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
}

.ff__label {
  font-size: 12px;
  color: var(--ink-2);
}

.ff__badge {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  color: var(--ink-3);
  background: #f2f4f7;
}

.ff__badge--required {
  color: var(--danger);
  background: var(--danger-soft);
}

.ff__hint {
  display: block;
  margin-top: 4px;
  font-size: 10px;
  color: var(--ink-4);
  line-height: 1.5;
}
</style>
