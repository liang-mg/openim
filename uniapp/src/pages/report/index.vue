<template>
  <view class="app-page">
    <page-header title="工作报告" @back="back">
      <template #right>
        <text class="text-sm text-white/90">{{ user.displayName }}</text>
      </template>
    </page-header>

    <view class="px-3 pt-3 pb-7">
      <week-progress :submitted="overview.week_submitted || 0" :required="overview.week_required || 5" :streak="overview.streak_days || 0" />

      <view class="oa-card">
        <view class="flex items-center justify-between mb-2.5">
          <text class="text-lg font-semibold text-ink">写日报</text>
          <view class="flex items-center gap-1 px-2.5 py-1 rounded-pill bg-brand-soft" @tap="copyYesterday">
            <app-icon name="list" :size="14" tone="brand" />
            <text class="text-xs text-brand">复制昨天</text>
          </view>
        </view>

        <report-editor ref="editor" :recent="recent" :today="todayKey" :yesterday="yesterdayKey" @submitted="refresh" />
      </view>

      <recent-reports :list="recent" @withdraw="doWithdraw" />
      <review-quote :review="overview.latest_review" />

      <text class="block px-1 pt-1 text-2xs text-ink-4 leading-relaxed">提交后 2 小时内可撤回修改；组长点评并上报后不可再改。</text>
    </view>
  </view>
</template>

<script>
import PageHeader from "@/components/page-header.vue";
import AppIcon from "@/components/app-icon.vue";
import WeekProgress from "./components/week-progress.vue";
import ReportEditor from "./components/report-editor.vue";
import RecentReports from "./components/recent-reports.vue";
import ReviewQuote from "./components/review-quote.vue";
import { getReportOverview, withdrawReport } from "@/api/oa";
import { bjYmd } from "@/utils/beijing";
import { useUserStore } from "@/store/user";
import { getToken } from "@/utils/storage";

/**
 * 工作报告（日报）页面层，只负责：
 *   1. 取数 getReportOverview（本周进度 + 最近报告 + 上级点评）；
 *   2. 撤回 withdrawReport；
 *   3. 「复制昨天」：从 recent 找昨天的报告，通过 ref 调编辑器 fillFrom 回填。
 * 编辑器块（今天/昨天、锁定、字段、附件、存草稿/提交、上传接口）在 components/report-editor.vue。
 */
export default {
  components: { PageHeader, AppIcon, WeekProgress, ReportEditor, RecentReports, ReviewQuote },
  data() {
    // 日期键按北京时间算（设备时区不是东八区时，昨天会算错）
    const todayKey = bjYmd(Date.now());
    const yesterdayKey = bjYmd(Date.now() - 24 * 60 * 60 * 1000);
    return {
      loading: false,
      overview: { week_submitted: 0, week_required: 5, streak_days: 0, recent: [], latest_review: null },
      todayKey,
      yesterdayKey,
    };
  },
  computed: {
    user() {
      return useUserStore();
    },
    recent() {
      return this.overview.recent || [];
    },
  },
  onShow() {
    if (!getToken()) {
      uni.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.user.fetchProfile().catch(() => {});
    this.refresh();
  },
  methods: {
    async refresh() {
      this.loading = true;
      try {
        const data = await getReportOverview();
        this.overview = {
          week_submitted: data.week_submitted || 0,
          week_required: data.week_required || 5,
          streak_days: data.streak_days || 0,
          recent: (data.recent || []).map((r) => ({ ...r, attachments: r.attachments || [] })),
          latest_review: data.latest_review || null,
        };
      } catch (e) {
        uni.showToast({ title: e.message || "报告概览加载失败", icon: "none" });
      } finally {
        this.loading = false;
      }
    },
    /** 复制昨天：内容与 period 切换交给编辑器 fillFrom（编辑器内部有 loadedPeriod 防覆盖） */
    copyYesterday() {
      const found = this.recent.find((r) => r.period === this.yesterdayKey);
      if (!found) {
        uni.showToast({ title: "昨天没有可复制的日报", icon: "none" });
        return;
      }
      if (this.$refs.editor) this.$refs.editor.fillFrom(found.content, this.yesterdayKey);
      uni.showToast({ title: "已带入昨天的日报内容，可在此基础上修改", icon: "none" });
    },
    async doWithdraw(reportId) {
      try {
        await withdrawReport(reportId);
        uni.showToast({ title: "已撤回为草稿，可修改后重新提交", icon: "none" });
        await this.refresh();
      } catch (e) {
        uni.showToast({ title: e.message || "撤回失败", icon: "none" });
      }
    },
    back() {
      const pages = getCurrentPages();
      if (pages.length > 1) uni.navigateBack();
      else uni.switchTab({ url: "/pages/work/index" });
    },
  },
};
</script>
