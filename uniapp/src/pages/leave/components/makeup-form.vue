<template>
  <bottom-sheet :open="open" title="申请补卡" @close="$emit('close')">
    <view class="flex gap-2.5">
      <form-field class="flex-1" label="补卡日期">
        <picker mode="date" :value="form.date" :start="minDate" :end="today" @change="form.date = $event.detail.value">
          <view class="oa-input leading-10">{{ form.date || "请选择" }}</view>
        </picker>
      </form-field>
      <form-field class="flex-1" label="补哪次卡">
        <picker mode="selector" :range="kinds" range-key="label" :value="kindIndex" @change="onKindChange">
          <view class="oa-input leading-10">{{ form.type === "on" ? "上班卡" : "下班卡" }}</view>
        </picker>
      </form-field>
    </view>

    <form-field label="补卡时间" badge="必填" badge-tone="required" hint="24 小时制，例如 09:30">
      <input v-model="form.time" class="oa-input" placeholder="09:30" placeholder-class="text-ink-4" maxlength="5" />
    </form-field>

    <form-field label="原因" badge="必填" badge-tone="required">
      <textarea v-model="form.reason" class="oa-textarea h-20" placeholder="说明为什么漏打卡" placeholder-class="text-ink-4" maxlength="200" />
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

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 补卡申请弹层（草稿与校验都在组件内，页面只接 submit） */
export default {
  name: "MakeupForm",
  components: { BottomSheet, FormField },
  props: {
    open: { type: Boolean, default: false },
    today: { type: String, default: "" },
    minDate: { type: String, default: "" },
    submitting: { type: Boolean, default: false },
  },
  emits: ["close", "submit"],
  data() {
    return {
      form: { date: this.today, type: "on", time: "", reason: "" },
      kinds: [
        { value: "on", label: "上班卡" },
        { value: "off", label: "下班卡" },
      ],
    };
  },
  computed: {
    kindIndex() {
      const i = this.kinds.findIndex((x) => x.value === this.form.type);
      return i < 0 ? 0 : i;
    },
  },
  watch: {
    open(val) {
      if (val) this.form = { date: this.today, type: "on", time: "", reason: "" };
    },
  },
  methods: {
    onKindChange(e) {
      const item = this.kinds[Number(e.detail.value)];
      if (item) this.form.type = item.value;
    },
    submit() {
      const { date, type, time, reason } = this.form;
      if (!date) return uni.showToast({ title: "请选择补卡日期", icon: "none" });
      if (!TIME_RE.test(String(time || "").trim())) return uni.showToast({ title: "时间格式为 HH:MM", icon: "none" });
      if (!String(reason || "").trim()) return uni.showToast({ title: "请填写补卡原因", icon: "none" });
      this.$emit("submit", { date, type, time: time.trim(), reason: reason.trim() });
    },
  },
};
</script>
