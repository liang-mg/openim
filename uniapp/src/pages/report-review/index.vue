<template>
  <view class="app-page rv">
    <page-header :title="detailOpen ? (selected ? selected.author.name : '报告查阅') : '报告查阅'" @back="onBack">
      <template #right>
        <status-tag :text="viewLabel" tone="brand" background="rgba(255,255,255,0.2)" color="#ffffff" />
      </template>
    </page-header>

    <!-- 无权限 -->
    <empty-state v-if="!canView && !loading" text="报告查阅仅组长与领导可用" name="shield" />

    <!-- 列表 -->
    <view v-else-if="!detailOpen" class="rv-body px-3 pt-3 pb-7">
      <view class="rv-tabs flex gap-4 px-0.5 pb-2.5">
        <view class="rv-tab relative pb-1.5" :class="{ 'rv-tab--active': tab === 'pending' }" @tap="switchTab('pending')">
          <text class="rv-tab__text text-base" :class="tab === 'pending' ? 'text-brand font-semibold' : 'text-ink-2'">待查阅 {{ pendingList.length }}</text>
          <view v-if="tab === 'pending'" class="absolute left-0 right-0 bottom-0 h-0.5 bg-brand rounded-full" />
        </view>
        <view class="rv-tab relative pb-1.5" :class="{ 'rv-tab--active': tab === 'archived' }" @tap="switchTab('archived')">
          <text class="rv-tab__text text-base" :class="tab === 'archived' ? 'text-brand font-semibold' : 'text-ink-2'">已归档 {{ archivedList.length }}</text>
          <view v-if="tab === 'archived'" class="absolute left-0 right-0 bottom-0 h-0.5 bg-brand rounded-full" />
        </view>
      </view>

      <empty-state v-if="loading" text="加载中…" />
      <empty-state v-else-if="!list.length" text="暂无报告" name="document" />

      <view v-else>
        <review-row
          v-for="r in list"
          :key="r.report_id"
          :report="r"
          :status-text="listStatus(r)"
          :status-tone="r.status === 'archived' ? 'success' : 'brand'"
          @open="openReport"
        />
      </view>
    </view>

    <!-- 详情 -->
    <view v-else class="rv-body px-3 pt-3 pb-7">
      <view class="inline-flex items-center gap-0.5 px-0.5 pb-2.5" @tap="detailOpen = false">
        <app-icon name="chevron-left" :size="14" color="var(--brand)" />
        <text class="detail-back__text text-base text-brand">返回列表</text>
      </view>

      <report-detail
        v-if="selected"
        :report="selected"
        :manager-review="managerReview"
        :leader-review="leaderReview"
        :actions="actions"
        :submitting="submitting"
        @submit="doSubmit"
        @download="onDownload"
      />
    </view>
  </view>
</template>

<script>
import PageHeader from "@/components/page-header.vue";
import AppIcon from "@/components/app-icon.vue";
import StatusTag from "@/components/status-tag.vue";
import EmptyState from "@/components/empty-state.vue";
import ReviewRow from "./components/review-row.vue";
import ReportDetail from "./components/report-detail.vue";
import { getMe, getAllReportsForReview, submitReview, getFileLink, fileIdOf } from "@/api/oa";
import { getToken } from "@/utils/storage";

/**
 * 报告查阅。对齐 PC 端 frontend/src/pages/report-review/index.tsx：
 *   组长视角：待我查阅 → 点评 + 上报领导
 *   领导视角：待查阅 / 已归档 → 点评 + 归档
 *
 * 移动端差异：PC 的左右分栏改成「列表 → 详情」两级；领导归档最后一条后自动切到「已归档」页签。
 * 渲染细节在 components/ 里：review-row（列表行）、report-detail（详情卡片）、comment-box（点评输入）。
 * 本页只保留：角色判断、取数、两级点评流程、列表/详情切换。
 */
export default {
  components: { PageHeader, AppIcon, StatusTag, EmptyState, ReviewRow, ReportDetail },
  data() {
    return {
      loading: true,
      me: {},
      tab: "pending",
      detailOpen: false,
      selectedId: "",
      submitting: false,
      pendingList: [],
      archivedList: [],
      managerReview: null,
      leaderReview: null,
    };
  },
  computed: {
    isManager() {
      return this.me.role === "manager";
    },
    isLeader() {
      return ["leader", "hr", "admin"].includes(this.me.role);
    },
    canView() {
      return this.isManager || this.isLeader;
    },
    viewLabel() {
      if (this.isManager) return "组长视角";
      if (this.isLeader) return "领导视角";
      return "独立页面";
    },
    list() {
      return this.tab === "pending" ? this.pendingList : this.archivedList;
    },
    selected() {
      return this.list.find((r) => r.report_id === this.selectedId) || null;
    },
    /** 服务端下发的可执行动作（能不能点评、能不能上报/归档都由它决定） */
    actions() {
      return (this.selected && this.selected.review_actions) || {};
    },
  },
  onShow() {
    if (!getToken()) {
      uni.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.init();
  },
  methods: {
    listStatus(r) {
      if (r.status === "archived") return "已归档";
      return this.isManager ? "待点评" : "待查阅";
    },
    async init() {
      this.loading = true;
      try {
        this.me = await getMe();
        if (!this.canView) return;
        const all = await this.reload();
        const hasPending = all.some((r) => r.status === "pending_leader");
        this.tab = hasPending || this.isManager ? "pending" : "archived";
      } catch (e) {
        uni.showToast({ title: e.message || "加载失败，请稍后重试", icon: "none" });
      } finally {
        this.loading = false;
      }
    },
    async reload() {
      // 与 PC 一致：一次拿「待处理 + 已归档」，服务端按汇报链过滤
      const all = await getAllReportsForReview();
      this.pendingList = all.filter((r) => r.status !== "archived");
      this.archivedList = all.filter((r) => r.status === "archived");
      return all;
    },
    switchTab(t) {
      this.tab = t;
    },
    openReport(r) {
      this.selectedId = r.report_id;
      this.managerReview = (r.reviews || []).find((x) => x.role === "manager") || null;
      this.leaderReview = (r.reviews || []).find((x) => x.role === "leader") || null;
      this.detailOpen = true;
    },
    onDownload({ url, name }) {
      this.openAttachment(url, name);
    },
    async doSubmit(text) {
      if (this.submitting || !this.selected) return;
      const value = String(text || "").trim();
      if (!value) {
        uni.showToast({ title: "先写下点评内容", icon: "none" });
        return;
      }
      this.submitting = true;
      try {
        const report = this.selected;
        const actions = report.review_actions || {};
        // 与 PC 同一套：view 按阶段判定，complete 表示「本次点评同时完成上报/归档」
        const view = report.status === "pending_leader" ? "leader" : "manager";
        const complete = Boolean(actions.can_escalate || actions.can_archive);
        await submitReview(report.report_id, value, view, complete);
        uni.showToast({
          title: actions.can_escalate ? "点评已提交，已上报终审" : actions.can_archive ? "点评已提交并归档" : "点评已保存",
          icon: "none",
        });
        this.detailOpen = false;
        await this.reload();
        // 归档完最后一条时待查阅会变空，直接切到「已归档」，避免误以为没生效
        if (!this.pendingList.length && this.archivedList.length) this.tab = "archived";
      } catch (e) {
        uni.showToast({ title: e.message || "提交失败，请重试", icon: "none" });
      } finally {
        this.submitting = false;
      }
    },
    async openAttachment(url, name) {
      const id = fileIdOf(url);
      if (!id) {
        uni.showToast({ title: "附件地址无效", icon: "none" });
        return;
      }
      try {
        const link = await getFileLink(id);
        const signed = link.signed_url;
        // #ifdef H5
        window.open(signed, "_blank", "noopener");
        // #endif
        // #ifndef H5
        uni.downloadFile({
          url: signed,
          success: (res) => {
            if (res.statusCode === 200) uni.openDocument({ filePath: res.tempFilePath, showMenu: true });
            else uni.showToast({ title: "下载失败", icon: "none" });
          },
          fail: () => uni.showToast({ title: "下载失败", icon: "none" }),
        });
        // #endif
      } catch (e) {
        uni.showToast({ title: e.message || `下载「${name}」失败`, icon: "none" });
      }
    },
    onBack() {
      if (this.detailOpen) {
        this.detailOpen = false;
        return;
      }
      const pages = getCurrentPages();
      if (pages.length > 1) uni.navigateBack();
      else uni.switchTab({ url: "/pages/work/index" });
    },
  },
};
</script>
