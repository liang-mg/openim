<template>
  <view v-if="review" class="oa-card">
    <text class="block text-lg font-semibold text-ink mb-2">上级点评</text>
    <text class="block text-base text-ink leading-relaxed pl-2.5 border-l-4 border-brand-soft">{{ review.comment }}</text>
    <text class="block mt-2 text-xs text-ink-4 text-right">—— {{ review.reviewer_name }} · {{ review.review_time }}</text>
  </view>
</template>

<script>
/** 上级点评展示（日报页底部） */
export default {
  name: "ReviewQuote",
  props: {
    review: { type: Object, default: null },
  },
};
</script>
