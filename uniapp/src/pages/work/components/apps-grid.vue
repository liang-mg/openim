<template>
  <view class="apps oa-card">
    <text class="apps__title block text-lg font-semibold text-ink mb-3.5">常用应用</text>
    <view class="apps__grid flex flex-wrap">
      <view
        v-for="app in apps"
        :key="app.key"
        class="apps__item w-1/3 py-2 px-0.5 flex flex-col items-center gap-2"
        @tap="openApp(app)"
      >
        <view class="apps__icon w-13 h-13 rounded-card flex items-center justify-center" :style="{ background: app.bg }">
          <app-icon :name="app.icon" :size="24" :color="app.fg" />
        </view>
        <text class="apps__name text-sm text-ink">{{ app.name }}</text>
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
