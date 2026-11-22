<template>
  <view class="app-page work">
    <!-- 顶部蓝栏：标题 + 日期 + 头像（对齐 PC 端 work-topbar） -->
    <view class="work__topbar app-topbar">
      <text class="work__title text-lg font-semibold">工作台</text>
      <view class="work__topbar-right flex items-center gap-2.5">
        <text class="work__date text-sm opacity-90">{{ dateLabel }} · {{ user.displayName }}</text>
        <oim-avatar :text="user.avatarText" :size="28" />
      </view>
    </view>

    <view class="work__inner px-3 pt-3.5 pb-6">
      <!-- 今日打卡：「现在 HH:mm」的时钟由卡片自己开、自己清，页面不再持 timer -->
      <checkin-card :checkin="checkin" @open="go('/pages/checkin/index')" />

      <!-- 待办 -->
      <todo-card :todos="todos" :report="report" :checkin="checkin" @open="go" />

      <!-- 常用应用 -->
      <apps-grid :apps="apps" />

      <view class="page-bottom-space" />
    </view>

    <app-tabbar active="work" />
  </view>
</template>

<script>
import { hideNativeTabBar } from "@/utils/tabbar";
import OimAvatar from "@/components/oim-avatar.vue";
import AppTabbar from "@/components/app-tabbar.vue";
import CheckinCard from "./components/checkin-card.vue";
import TodoCard from "./components/todo-card.vue";
import AppsGrid from "./components/apps-grid.vue";
import { getWorkbenchSummary } from "@/api/oa";
import { dateText } from "@/utils/format";
import { toUniPath } from "@/utils/nav";
import { peek, put } from "@/utils/swr";
import { useUserStore } from "@/store/user";
import { getToken } from "@/utils/storage";

const EMPTY_CHECKIN = {
  has_on: false,
  has_off: false,
  on_time: "",
  off_time: "",
  on_status: "",
  off_status: "",
  location: "",
  btn_text: "拍照打卡上班",
};

const EMPTY_REPORT = { submitted: false, status: "", period: "" };

/**
 * 工作台。逐块对齐 PC 端 frontend/src/pages/work/index.tsx：
 * 蓝底今日打卡卡 → 待办 → 常用应用九宫格（PC 端移动断点是 3 列）。
 *
 * 渲染拆到 components/：checkin-card（打卡卡 + 北京时间时钟）、todo-card（待办与空态）、
 * apps-grid（九宫格与未开放功能提示）。本页只保留：缓存优先渲染 + 后台刷新、
 * 待办 path → uni 页面的跳转映射、tabbar。
 */
export default {
  components: { OimAvatar, AppTabbar, CheckinCard, TodoCard, AppsGrid },
  data() {
    return {
      todos: [],
      checkin: { ...EMPTY_CHECKIN },
      report: { ...EMPTY_REPORT },
      apps: [
        { key: "checkin", name: "拍照打卡", icon: "camera", fg: "var(--brand)", bg: "var(--brand-soft)", path: "/pages/checkin/index" },
        { key: "report", name: "工作报告", icon: "document", fg: "var(--brand)", bg: "var(--brand-soft)", path: "/pages/report/index" },
        { key: "attendance", name: "出勤记录", icon: "clock", fg: "var(--brand)", bg: "var(--brand-soft)", path: "/pages/attendance/index" },
        { key: "leave", name: "请假补卡", icon: "calendar", fg: "var(--brand)", bg: "var(--brand-soft)", path: "/pages/leave/index" },
        { key: "meeting", name: "线上会议", icon: "video", fg: "var(--brand)", bg: "var(--brand-soft)", path: "" },
        { key: "approval", name: "审批中心", icon: "check-square", fg: "var(--brand)", bg: "var(--brand-soft)", path: "/pages/approvals/index" },
        { key: "calendar", name: "工作日历", icon: "calendar", fg: "var(--brand)", bg: "var(--brand-soft)", path: "" },
      ],
    };
  },
  computed: {
    user() {
      return useUserStore();
    },
    dateLabel() {
      return dateText();
    },
  },
  onShow() {
    hideNativeTabBar();
    if (!getToken()) {
      uni.reLaunch({ url: "/pages/login/index" });
      return;
    }
    // 先用缓存把首屏铺出来（切 tab 回来时几乎零等待），再后台刷新
    this.applyCache();
    this.load();
  },
  async onPullDownRefresh() {
    await this.load();
    uni.stopPullDownRefresh();
  },
  methods: {
    applyCache() {
      const cached = peek("work:summary");
      if (!cached) return;
      this.todos = cached.todos || [];
      this.checkin = cached.checkin || { ...EMPTY_CHECKIN };
      this.report = cached.report || { ...EMPTY_REPORT };
    },
    async load() {
      // 身份与工作台数据并行取：串行会让首屏多等一个 RTT
      const [summary] = await Promise.all([
        getWorkbenchSummary().catch((e) => {
          // 工作台是首页，接口异常不打断浏览，保留空态
          uni.showToast({ title: e.message || "工作台数据加载失败", icon: "none" });
          return null;
        }),
        this.user.fetchProfile().catch(() => null),
      ]);
      if (!summary) {
        if (!peek("work:summary")) this.todos = [];
        return;
      }
      const data = {
        todos: summary.todos || [],
        checkin: summary.checkin || { ...EMPTY_CHECKIN },
        report: summary.report || { ...EMPTY_REPORT },
      };
      this.todos = data.todos;
      this.checkin = data.checkin;
      this.report = data.report;
      put("work:summary", data);
    },
    go(path) {
      if (!path) return;
      // 后端给的是 PC 的 web 路由（/report），要转成 uni 页面地址
      const url = toUniPath(path);
      if (!url) {
        uni.showToast({ title: "该功能移动端暂未开放", icon: "none" });
        return;
      }
      uni.navigateTo({ url });
    },
  },
};
</script>
