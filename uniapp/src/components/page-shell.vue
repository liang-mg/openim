<template>
  <view class="app-page">
    <view class="app-header">
      <view class="app-header__side" @tap="back">
        <text class="shell__back">‹</text>
      </view>
      <text class="app-header__title">{{ title }}</text>
      <view class="app-header__side" />
    </view>

    <view class="shell__content">
      <slot>
        <view class="empty">
          <text class="shell__empty-title">{{ emptyTitle || "页面建设中" }}</text>
          <text class="shell__empty-sub">{{ emptySub }}</text>
        </view>
      </slot>
    </view>
  </view>
</template>

<script>
/**
 * 通用内页外壳：带返回的顶部栏 + 可滚动内容。
 * 迁移各业务页面时统一用它，保证导航栏高度、返回行为一致。
 */
export default {
  name: "PageShell",
  props: {
    title: { type: String, default: "" },
    emptyTitle: { type: String, default: "" },
    emptySub: { type: String, default: "" },
  },
  methods: {
    back() {
      const pages = getCurrentPages();
      if (pages.length > 1) uni.navigateBack();
      else uni.switchTab({ url: "/pages/work/index" });
    },
  },
};
</script>

<style scoped>
.shell__back {
  font-size: 26px;
  line-height: 1;
  color: var(--ink);
  width: 32px;
}

.shell__content {
  min-height: 60vh;
}

.shell__empty-title {
  font-size: 14px;
  color: var(--ink-2);
}

.shell__empty-sub {
  font-size: 12px;
  color: var(--ink-3);
  text-align: center;
  line-height: 1.7;
}
</style>
