<template>
  <view class="apps oa-card">
    <text class="apps__title block text-lg font-semibold text-ink mb-3.5">常用应用</text>
    <view class="apps__grid">
      <view v-for="app in apps" :key="app.key" class="apps__item" @tap="openApp(app)">
        <view class="apps__icon" :style="{ background: app.bg }">
          <app-icon :name="app.icon" :size="24" :color="app.fg" />
        </view>
        <text class="apps__name">{{ app.name }}</text>
      </view>
    </view>
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";

/**
 * 常用应用九宫格（PC 端移动断点是 3 列）。
 *
 * 应用清单（含 uni 页面地址）由页面配置，组件只负责渲染与点击：
 * 有地址直接跳，没地址的（线上会议 / 工作日历）明确提示「功能开发中」，
 * 不让用户点了没反应。
 */
export default {
  name: "AppsGrid",
  components: { AppIcon },
  props: {
    apps: { type: Array, default: () => [] },
  },
  methods: {
    openApp(app) {
      if (!app.path) {
        uni.showToast({ title: `${app.name} 功能开发中`, icon: "none" });
        return;
      }
      uni.navigateTo({ url: app.path });
    },
  },
};
</script>

<style scoped>
.apps__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px 6px;
}

.apps__item {
  min-height: 90px;
  padding: 8px 2px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  border-radius: var(--radius-card);
  box-sizing: border-box;
}

.apps__item:active {
  background: var(--fill);
}

.apps__icon {
  width: 50px;
  height: 50px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.apps__name {
  width: 100%;
  text-align: center;
  font-size: var(--text-sm);
  line-height: 1.35;
  color: var(--ink);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
