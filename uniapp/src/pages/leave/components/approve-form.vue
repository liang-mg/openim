<template>
  <bottom-sheet :open="open" :title="action === 'approve' ? '同意申请' : '拒绝申请'" desc="审批意见会同步给申请人，请说明原因。" @close="$emit('close')">
    <form-field label="审批意见" badge="必填" badge-tone="required">
      <textarea v-model="comment" class="oa-textarea h-20" placeholder="请填写审批意见" placeholder-class="text-ink-4" maxlength="200" />
    </form-field>

    <template #actions>
      <view class="oa-btn flex-1" @tap="$emit('close')"><text class="text-md text-ink">取消</text></view>
      <view class="flex-1" :class="action === 'approve' ? 'oa-btn-primary' : 'oa-btn-danger'" @tap="submit">
        <text class="text-md text-white font-medium">{{ action === "approve" ? "同意" : "拒绝" }}</text>
      </view>
    </template>
  </bottom-sheet>
</template>

<script>
import BottomSheet from "@/components/bottom-sheet.vue";
import FormField from "@/components/form-field.vue";

/** 审批意见弹层（请假/补卡共用） */
export default {
  name: "ApproveForm",
  components: { BottomSheet, FormField },
  props: {
    open: { type: Boolean, default: false },
    action: { type: String, default: "approve" },
  },
  emits: ["close", "submit"],
  data() {
    return { comment: "" };
  },
  watch: {
    open(val) {
      if (val) this.comment = "";
    },
  },
  methods: {
    submit() {
      const text = String(this.comment || "").trim();
      if (!text) return uni.showToast({ title: "请填写审批意见", icon: "none" });
      this.$emit("submit", text);
    },
  },
};
</script>
