<template>
  <view class="app-page">
    <!-- 顶部：返回 + 标题 + 月份切换 -->
    <page-header title="出勤记录" @back="back">
      <template #right>
        <view v-if="view !== 'report'" class="att-month-bar flex items-center gap-1">
          <view class="att-nav w-7 h-7 flex items-center justify-center" @tap="goMonth(-1)"><app-icon name="chevron-left" :size="16" /></view>
          <text class="att-month text-base text-white">{{ monthLabel }}</text>
          <view class="att-nav w-7 h-7 flex items-center justify-center" :class="{ 'opacity-40': calMonth >= curMonth }" @tap="goMonth(1)"><app-icon name="chevron-right" :size="16" /></view>
        </view>
      </template>
    </page-header>

    <!-- 三档切换（.att-tab / .att-tab__text 被回归脚本依赖，别改名） -->
    <view class="att-tabs sticky top-13 z-10 flex bg-white border-b border-line">
      <view v-for="tab in visibleTabs" :key="tab.value" class="att-tab flex-1 h-11 flex items-center justify-center relative" @tap="view = tab.value">
        <text class="att-tab__text text-md" :class="view === tab.value ? 'text-brand font-semibold' : 'text-ink-2'">{{ tab.label }}</text>
        <view v-if="view === tab.value" class="absolute bottom-0 left-1/2 -translate-x-1/2 w-2/5 h-0.5 bg-brand rounded-pill" />
      </view>
      <view v-if="view !== 'report' && calMonth !== curMonth" class="att-reset ml-auto self-center mr-2 px-2 py-1 rounded-ctl bg-brand-soft" @tap="backToThisMonth"><text class="text-xs text-brand">回到本月</text></view>
    </view>

    <view class="att-rule px-3.5 py-2 bg-fill">
      <text class="text-xs text-ink-3">工作时间 {{ rule.work_on_time || "09:05" }} 上班 · {{ rule.work_off_time || "18:00" }} 下班</text>
    </view>

    <!-- 我的出勤：统计 + 月历卡 + 当天明细 -->
    <view v-if="view === 'mine'" class="att-body px-3 pt-3 pb-7">
      <stat-row :summary="summary" />
      <mine-calendar-card :cells="cells" :by-date="byDate" :today-key="todayKey" :selected="selected" :has-data="monthHasData" :rule="rule" :leave-days="leaveDays" @select="selected = $event" />
      <day-detail :date-text="dayInfo.dateText" :state-text="dayInfo.stateText" :state-tone="dayInfo.stateTone" :hint="dayInfo.hint" :rows="dayInfo.rows" :photo="dayInfo.photo" :out-fence="dayInfo.outFence" @photo="openPhoto(dayInfo.photo)" @goto="goCheckin" />
    </view>

    <!-- 团队出勤：范围切换 + 只看异常 + 成员卡（点开是成员月历抽屉） -->
    <view v-else-if="view === 'team'" class="att-body px-3 pt-3 pb-7">
      <view class="toolbar flex items-center justify-between gap-2.5 mb-2.5">
        <scope-switch v-if="canViewAll" :value="scope" @update="switchScope" />
        <view class="flex items-center gap-1.5" @tap="toggleException">
          <text class="text-sm text-ink-2">只看异常</text>
          <view class="w-9 h-5 rounded-pill relative transition-colors" :class="onlyException ? 'bg-brand' : 'bg-ink-4'">
            <view class="absolute top-0.5 left-0.5 w-4 h-4 rounded-pill bg-white transition-transform" :class="{ 'translate-x-4': onlyException }" />
          </view>
        </view>
      </view>

      <team-summary v-if="teamData && teamData.summary" :summary="teamData.summary" />
      <skeleton v-if="teamLoading" :lines="4" :height="16" />
      <empty-state v-else-if="!teamMembers.length" text="该月没有可统计的成员" name="users" />
      <view v-else class="members">
        <member-row v-for="m in teamMembers" :key="m.user_id" :member="m" @open="openMember" />
      </view>
      <view class="att-foot pt-2.5 px-1 text-2xs text-ink-4 leading-relaxed">今天未到下班点不计入缺卡；已批准请假不计缺卡；工作日按周一至周五。</view>
    </view>

    <!-- 出勤报表：范围切换 + 导出 CSV + 每人一卡 + 合计 -->
    <view v-else class="att-body px-3 pt-3 pb-7">
      <view class="toolbar flex items-center justify-between gap-2.5 mb-2.5">
        <scope-switch v-if="canViewAll" :value="scope" @update="switchScope" />
        <view class="ml-auto px-3 py-1.5 rounded-ctl bg-brand" :class="{ 'opacity-50': exporting }" @tap="exportCsv"><text class="text-sm text-white">{{ exporting ? "导出中…" : "导出报表" }}</text></view>
      </view>

      <view v-if="hasHolidayWarning" class="bg-warn-soft rounded-ctl p-2.5 mb-2.5">
        <text class="text-xs text-warn-text leading-relaxed">报表已计入已批准请假（不算缺卡、不计入应出勤）；工作日按周一至周五判，节假日日历尚未接入。</text>
      </view>

      <skeleton v-if="reportLoading" :lines="4" :height="16" />
      <empty-state v-else-if="!reportRows.length" text="该月没有可统计的成员" name="chart" />
      <view v-else class="reports">
        <report-row v-for="r in reportRows" :key="r.user_id" :row="r" />
        <report-row v-if="reportTotal" :row="reportTotal" total />
      </view>
      <view class="att-foot pt-2.5 px-1 text-2xs text-ink-4 leading-relaxed">统计口径：工作时间为 {{ rule.work_on_time || "09:05" }} 上班、{{ rule.work_off_time || "18:00" }} 下班；工作日按周一至周五；今天未到下班点不计入缺卡。生成时间 {{ reportData ? reportData.generated_at : "—" }}</view>
    </view>

    <!-- 成员月历抽屉 -->
    <member-sheet :open="member.open" :name="member.name" :month-text="monthLabel" :month="calMonth" :by-date="member.byDate" :today-key="todayKey" :has-data="member.hasData" :rule="member.rule" :leave-days="member.leaveDays" :month-stats="member.month" :loading="member.loading" @close="closeMember" />
  </view>
</template>

<script>
import PageHeader from "@/components/page-header.vue";
import AppIcon from "@/components/app-icon.vue";
import Skeleton from "@/components/skeleton.vue";
import EmptyState from "@/components/empty-state.vue";
import StatRow from "./components/stat-row.vue";
import MemberRow from "./components/member-row.vue";
import ReportRow from "./components/report-row.vue";
import MemberSheet from "./components/member-sheet.vue";
import MineCalendarCard from "./components/mine-calendar-card.vue";
import DayDetail from "./components/day-detail.vue";
import TeamSummary from "./components/team-summary.vue";
import ScopeSwitch from "./components/scope-switch.vue";
import { getMe, getCheckinList, getTeamCheckin, getMemberCheckin, getAttendanceReport, downloadAttendanceReport, getLeaveList, getFileLink, fileIdOf } from "@/api/oa";
import { buildCells, shiftMonth, ymd } from "@/utils/checkin";
import { groupByDate, summarizeMonth, dayDetailOf, leaveDaysFromLeaveList } from "./derived.js";
import { getToken } from "@/utils/storage";

/**
 * 出勤记录（对齐 PC 端 pages/attendance/）：三档切换 + 取数 + 成员抽屉 + 导出；渲染在 components/，派生在 derived.js。
 */
export default {
  components: { PageHeader, AppIcon, Skeleton, EmptyState, StatRow, MemberRow, ReportRow, MemberSheet, MineCalendarCard, DayDetail, TeamSummary, ScopeSwitch },
  data() {
    const todayKey = ymd(new Date());
    return {
      todayKey, curMonth: todayKey.slice(0, 7),
      calMonth: todayKey.slice(0, 7),
      view: "mine",
      scope: "team",
      me: null,
      rule: {},
      now: new Date(),
      records: [],
      leaveDays: {}, // 已批准请假日 { "YYYY-MM-DD": true }，来自 /checkin/list 的 approved_leave_days
      loading: false,
      selected: todayKey,
      teamData: null,
      teamLoading: false,
      onlyException: false,
      member: { open: false, name: "", loading: false, byDate: {}, leaveDays: {}, hasData: false, rule: null, month: {} },
      reportData: null,
      reportLoading: false,
      exporting: false,
    };
  },
  computed: {
    monthLabel() {
      return `${this.calMonth.slice(0, 4)} 年 ${Number(this.calMonth.slice(5, 7))} 月`;
    },
    canViewTeam() {
      return Boolean(this.me && this.me.can_view_team);
    },
    canViewAll() {
      return Boolean(this.me && this.me.can_view_all);
    },
    visibleTabs() {
      const tabs = [{ label: "我的出勤", value: "mine" }];
      if (this.canViewTeam) tabs.push({ label: "团队出勤", value: "team" });
      if (this.canViewTeam || this.canViewAll) tabs.push({ label: "出勤报表", value: "report" });
      return tabs;
    },
    cells() {
      return buildCells(this.calMonth);
    },
    byDate() {
      return groupByDate(this.records);
    },
    monthHasData() {
      return this.records.length > 0;
    },
    summary() {
      return summarizeMonth(this.cells, this.byDate, this.todayKey, this.now, this.rule, this.monthHasData, this.leaveDays);
    },
    dayInfo() {
      return dayDetailOf(this.selected, this.byDate[this.selected] || {}, this.todayKey, this.now, this.rule, Boolean(this.leaveDays[this.selected]));
    },
    teamMembers() {
      return (this.teamData && this.teamData.members) || [];
    },
    reportRows() {
      return (this.reportData && this.reportData.rows) || [];
    },
    reportTotal() {
      return this.reportData ? this.reportData.total : null;
    },
    hasHolidayWarning() {
      return Boolean(this.reportData && (this.reportData.warnings || []).includes("holiday_calendar_not_integrated"));
    },
  },
  watch: {
    calMonth() { this.reloadCurrent(); this.member.open = false; },
    view() { this.reloadCurrent(); },
    scope() { this.reloadCurrent(); },
    onlyException() { if (this.view === "team") this.loadTeam(); },
  },
  onShow() {
    if (!getToken()) {
      uni.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.now = new Date();
    this.init();
  },
  methods: {
    toastError(e, fallback) {
      uni.showToast({ title: e.message || fallback, icon: "none" });
    },
    async init() {
      // 身份决定能不能看到团队/报表两档，不在前端按角色硬编码
      try {
        this.me = await getMe();
        if (this.me.can_view_team && this.view === "mine") this.view = "team";
      } catch (e) {
        /* 取身份失败不影响看自己的出勤 */
      }
      this.reloadCurrent();
    },
    reloadCurrent() {
      this.view === "mine" ? this.loadMine() : this.view === "team" ? this.loadTeam() : this.loadReport();
    },
    async loadMine() {
      if (this.view !== "mine") return;
      this.loading = true;
      try {
        const [res, fallback] = await Promise.all([
          getCheckinList(this.calMonth),
          // 旧后端缺 approved_leave_days：用请假列表兜底，新字段优先
          getLeaveList({ scope: "mine", status: "approved" })
            .then((r) => leaveDaysFromLeaveList(r.list, this.calMonth))
            .catch(() => ({})),
        ]);
        this.records = res.list || [];
        this.leaveDays = res.approved_leave_days || fallback || {};
        if (res.rule) this.rule = res.rule;
      } catch (e) {
        this.records = []; this.leaveDays = {};
        this.toastError(e, "出勤记录加载失败");
      } finally { this.loading = false; }
    },
    async loadTeam() {
      if (!this.canViewTeam) return;
      this.teamLoading = true;
      try {
        const res = await getTeamCheckin({ month: this.calMonth, scope: this.scope, onlyException: this.onlyException });
        this.teamData = res;
        if (res.rule) this.rule = res.rule;
      } catch (e) {
        this.teamData = null;
        this.toastError(e, "团队出勤加载失败");
      } finally { this.teamLoading = false; }
    },
    async loadReport() {
      this.reportLoading = true;
      try {
        const res = await getAttendanceReport({ month: this.calMonth, scope: this.scope });
        this.reportData = res;
        if (res.rule) this.rule = res.rule;
      } catch (e) {
        this.reportData = null;
        this.toastError(e, "报表加载失败");
      } finally { this.reportLoading = false; }
    },
    goMonth(delta) {
      if (delta > 0 && this.calMonth >= this.curMonth) return;
      this.calMonth = shiftMonth(this.calMonth, delta);
      this.selected = this.calMonth === this.curMonth ? this.todayKey : `${this.calMonth}-01`;
    },
    backToThisMonth() { this.calMonth = this.curMonth; this.selected = this.todayKey; },
    switchScope(next) { if (this.scope !== next) this.scope = next; },
    toggleException() { this.onlyException = !this.onlyException; },
    async openMember(row) {
      this.member = { open: true, name: row.name, loading: true, byDate: {}, leaveDays: {}, hasData: false, rule: this.rule, month: row.month || {} };
      try {
        const res = await getMemberCheckin(row.user_id, this.calMonth);
        const list = res.list || [];
        this.member.byDate = groupByDate(list);
        this.member.leaveDays = res.approved_leave_days || {}; this.member.hasData = list.length > 0;
        this.member.rule = res.rule;
      } catch (e) {
        this.toastError(e, "成员月历加载失败");
      } finally { this.member.loading = false; }
    },
    closeMember() { this.member.open = false; },
    async openPhoto(record) {
      if (!record || !record.photo_url) return;
      const id = fileIdOf(record.photo_url);
      if (!id) {
        uni.showToast({ title: "照片地址无效", icon: "none" });
        return;
      }
      try {
        const link = await getFileLink(id);
        const url = link && (link.signed_url || link.url);
        if (!url) throw new Error("照片地址为空");
        uni.previewImage({ urls: [url] });
      } catch (e) {
        this.toastError(e, "照片打开失败");
      }
    },
    async exportCsv() {
      if (this.exporting) return;
      this.exporting = true;
      try {
        // 与 PC 同名同参：downloadAttendanceReport(month, format, scope)
        const filePath = await downloadAttendanceReport(this.calMonth, "csv", this.scope);
        // #ifdef H5
        const a = document.createElement("a");
        a.href = filePath;
        a.download = `出勤报表_${this.calMonth}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // #endif
        // #ifndef H5
        uni.openDocument({ filePath, showMenu: true });
        // #endif
        uni.showToast({ title: "报表已导出，可直接用 Excel 打开", icon: "none" });
      } catch (e) {
        this.toastError(e, "导出失败");
      } finally { this.exporting = false; }
    },
    goCheckin() { uni.navigateTo({ url: "/pages/checkin/index" }); },
    back() {
      const pages = getCurrentPages();
      if (pages.length > 1) uni.navigateBack();
      else uni.switchTab({ url: "/pages/work/index" });
    },
  },
};
</script>
