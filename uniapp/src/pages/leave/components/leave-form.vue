<template>
  <bottom-sheet :open="open" title="申请请假" @close="$emit('close')">
    <form-field label="请假类型">
      <picker mode="selector" :range="types" range-key="label" :value="typeIndex" @change="onTypeChange">
        <view class="oa-input leading-10">{{ typeText }}</view>
      </picker>
    </form-field>

    <view class="flex gap-2.5">
      <form-field class="flex-1" label="开始日期">
        <picker mode="date" :value="form.start" :start="today" @change="form.start = $event.detail.value">
          <view class="oa-input leading-10">{{ form.start || "请选择" }}</view>
        </picker>
      </form-field>
      <form-field class="flex-1" label="结束日期">
        <picker mode="date" :value="form.end" :start="form.start || today" @change="form.end = $event.detail.value">
          <view class="oa-input leading-10">{{ form.end || "请选择" }}</view>
        </picker>
      </form-field>
    </view>

    <form-field label="事由" badge="必填" badge-tone="required">
      <textarea v-model="form.reason" class="oa-textarea h-20" placeholder="简单说明请假原因" placeholder-class="text-ink-4" maxlength="200" />
    </form-field>

    <template #actions>
      <view class="oa-btn flex-1" @tap="$emit('close')"><text class="text-md text-ink">取消</text></view>
      <view class="oa-btn-primary flex-1" :class="{ 'opacity-45': submitting }" @tap="submit">
        <text class="text-md text-white font-medium">{{ submitting ? "提交中…" : "提交申请" }}</text>
      </view>
    </template>
  </bottom-sheet>
</template>

<script>
import BottomSheet from "@/components/bottom-sheet.vue";
import FormField from "@/components/form-field.vue";
import { LEAVE_TYPE_TEXT } from "@/api/oa";

/**
 * 请假申请弹层：自己维护草稿与校验，校验通过才 emit('submit', payload)。
 * 页面拿到 payload 只负责调接口，不用再管表单状态。
 */
/** 默认起止日期取「下一个工作日」（含今天）：周末打开请假时不要默认成周六周日，否则后端会以"不含工作日"拒绝 */
function nextWorkday(dateStr) {
  const d = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default {
  name: "LeaveForm",
  components: { BottomSheet, FormField },
  props: {
    open: { type: Boolean, default: false },
    today: { type: String, default: "" },
    submitting: { type: Boolean, default: false },
  },
  emits: ["close", "submit"],
  data() {
    const start = nextWorkday(this.today);
    return {
      form: { type: "personal", start, end: start, reason: "" },
      types: Object.keys(LEAVE_TYPE_TEXT).map((k) => ({ value: k, label: LEAVE_TYPE_TEXT[k] })),
    };
  },
  computed: {
    typeIndex() {
      const i = this.types.findIndex((x) => x.value === this.form.type);
      return i < 0 ? 0 : i;
    },
    typeText() {
      return LEAVE_TYPE_TEXT[this.form.type] || this.form.type;
    },
  },
  watch: {
    open(val) {
      // 每次打开重置为「今天、事假、空事由」，避免上次的残留
      if (val) this.form = { type: "personal", start: this.today, end: this.today, reason: "" };
    },
  },
  methods: {
    onTypeChange(e) {
      const item = this.types[Number(e.detail.value)];
      if (item) this.form.type = item.value;
    },
    submit() {
      const { type, start, end, reason } = this.form;
      if (!start || !end) return uni.showToast({ title: "请选择起止日期", icon: "none" });
      if (end < start) return uni.showToast({ title: "结束日期不能早于开始日期", icon: "none" });
      if (!String(reason || "").trim()) return uni.showToast({ title: "请填写事由", icon: "none" });
      this.$emit("submit", { type, start_date: start, end_date: end, reason: reason.trim() });
    },
  },
};
</script>
