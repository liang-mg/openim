<template>
  <view class="rule bg-white rounded-card p-3 mb-3">
    <view class="flex items-start justify-between gap-2.5 mb-2.5">
      <view class="flex-1 min-w-0">
        <text class="block text-md font-semibold text-ink">考勤规则</text>
        <text class="block mt-0.5 text-2xs text-ink-3 leading-relaxed">{{ ruleDesc }}</text>
      </view>
      <text class="px-2.5 py-1.5 rounded-ctl bg-brand-soft text-brand text-xs whitespace-nowrap" @tap="$emit('save')">
        {{ saving ? "保存中…" : "保存规则" }}
      </text>
    </view>

    <view v-if="rule" class="grid grid-cols-2 gap-x-2 gap-y-2.5">
      <view v-for="f in timeFields" :key="f.key" class="flex flex-col gap-1">
        <text class="text-2xs text-ink-3">{{ f.label }}</text>
        <picker mode="time" :value="rule[f.key]" @change="onField(f.key, $event)">
          <view class="oa-input leading-10 text-center">{{ rule[f.key] }}</view>
        </picker>
      </view>

      <view v-for="f in numFields" :key="f.key" class="flex flex-col gap-1">
        <text class="text-2xs text-ink-3">{{ f.label }}</text>
        <input
          class="oa-input leading-10 text-center"
          type="number"
          :value="String(rule[f.key])"
          @input="onField(f.key, $event)"
        />
      </view>

      <view v-for="f in switchFields" :key="f.key" class="flex items-center justify-between">
        <text class="text-2xs text-ink-3">{{ f.label }}</text>
        <toggle-switch :on="Boolean(rule[f.key])" @change="$emit('change', f.key, !rule[f.key])" />
      </view>
    </view>
  </view>
</template>

<script>
import ToggleSwitch from "./toggle-switch.vue";

/** 三个时间字段（picker mode=time），顺序与 PC 端一致 */
const TIME_FIELDS = [
  { key: "work_on_time", label: "上班时间" },
  { key: "work_off_time", label: "下班时间" },
  { key: "earliest_on", label: "最早上班卡" },
];

/** 三个数值字段（number input，页面负责转 Number） */
const NUM_FIELDS = [
  { key: "late_grace", label: "迟到宽限(分)" },
  { key: "makeup_max_days", label: "可补最近(天)" },
  { key: "makeup_max_month", label: "每月补卡上限" },
];

/** 两个开关 */
const SWITCH_FIELDS = [
  { key: "need_photo", label: "打卡需要照片" },
  { key: "need_location", label: "打卡需要定位" },
];

/**
 * 考勤规则卡片。
 *
 * 只渲染 + 抛事件（change/save），不自己调接口：
 *   - change(key, value)：页面 setRuleField 统一处理（数值字段转 Number）；
 *   - save：页面 doSaveRule 调保存接口。
 * 保留 .rule 类名：E2E 用 `.rule` 读取规则文案。
 */
export default {
  name: "RuleCard",
  components: { ToggleSwitch },
  props: {
    rule: { type: Object, default: null },
    saving: { type: Boolean, default: false },
  },
  emits: ["change", "save"],
  data() {
    return {
      timeFields: TIME_FIELDS,
      numFields: NUM_FIELDS,
      switchFields: SWITCH_FIELDS,
    };
  },
  computed: {
    ruleDesc() {
      if (!this.rule) return "";
      return this.rule.source === "env"
        ? "当前在用默认配置（09:05 上班 / 18:00 下班），保存后以这里为准"
        : "保存后立即生效；已产生的打卡记录判定不回溯，历史报表数字不变";
    },
  },
  methods: {
    onField(key, e) {
      this.$emit("change", key, e.detail.value);
    },
  },
};
</script>
