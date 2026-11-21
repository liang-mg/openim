<template>
  <view class="oa-card comment">
    <text class="comment__title block text-sm text-ink-2 mb-1.5">我的点评</text>
    <textarea
      v-model="text"
      class="comment__input oa-textarea h-20"
      :placeholder="placeholder"
      placeholder-class="text-ink-4"
      maxlength="500"
    />
    <view class="comment__foot flex items-center justify-between mt-2.5">
      <text class="comment__tip text-2xs text-ink-4">{{ tip }}</text>
      <text class="comment__btn px-3.5 py-2 rounded-ctl bg-brand text-white text-base" @tap="onSubmit">{{ btnText }}</text>
    </view>
  </view>
</template>

<script>
/**
 * 点评输入框 + 提交按钮。
 *
 * 按钮文案与提示由服务端下发的 review_actions 决定（can_escalate / can_archive），
 * 与 PC 一致：能上报就「点评并上报」，能归档就「提交点评并归档」，否则「保存点评」。
 * 输入内容由组件自己持有，提交时抛给页面校验并调接口。
 */
export default {
  name: "CommentBox",
  props: {
    /** review_actions: { can_comment, can_escalate, can_archive } */
    actions: { type: Object, default: () => ({}) },
    submitting: { type: Boolean, default: false },
  },
  emits: ["submit"],
  data() {
    return { text: "" };
  },
  computed: {
    placeholder() {
      return this.actions.can_escalate ? "写下点评，确认后可上报终审…" : "写下你的点评…";
    },
    tip() {
      if (this.actions.can_escalate) return "上报后进入领导终审";
      if (this.actions.can_archive) return "提交后归档，内容不可再改";
      return "提交后保存点评";
    },
    btnText() {
      if (this.submitting) return "提交中…";
      if (this.actions.can_escalate) return "点评并上报";
      if (this.actions.can_archive) return "提交点评并归档";
      return "保存点评";
    },
  },
  methods: {
    onSubmit() {
      if (this.submitting || !this.actions.can_comment) return;
      this.$emit("submit", this.text);
    },
  },
};
</script>
