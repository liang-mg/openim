<template>
  <view class="app-page">
    <page-header title="请假与补卡" @back="back">
      <template #right>
        <text class="text-xs bg-white/15 text-white px-2.5 py-1 rounded-pill" @tap="openSheet('makeup')">申请补卡</text>
        <text class="text-xs bg-white text-brand font-medium px-2.5 py-1 rounded-pill" @tap="openSheet('leave')">申请请假</text>
      </template>
    </page-header>

    <view class="sticky top-13 z-10 flex items-center bg-white border-b border-line pr-2">
      <view
        v-for="t in tabs"
        :key="t.value"
        class="lv-tab relative px-3.5 h-11 flex items-center"
        @tap="switchTab(t.value)"
      >
        <text class="text-base" :class="tab === t.value ? 'text-brand font-semibold' : 'text-ink-2'">{{ t.label }}</text>
        <view v-if="tab === t.value" class="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-pill bg-brand" />
      </view>

      <view v-if="tab !== 'mine' && canAll" class="ml-auto flex gap-1 bg-fill-2 rounded p-0.5">
        <text
          class="text-xs px-2 py-1 rounded"
          :class="scope === 'team' ? 'bg-white text-brand font-semibold' : 'text-ink-2'"
          @tap="switchScope('team')"
        >
          团队
        </text>
        <text
          class="text-xs px-2 py-1 rounded"
          :class="scope === 'all' ? 'bg-white text-brand font-semibold' : 'text-ink-2'"
          @tap="switchScope('all')"
        >
          全公司
        </text>
      </view>
    </view>

    <view class="px-3 pt-3 pb-7">
      <skeleton v-if="loading" :lines="6" :height="18" />

      <template v-else>
        <view class="mb-2">
          <view class="flex items-center gap-1.5 px-0.5 mb-2">
            <app-icon name="calendar" :size="15" tone="ink-2" />
            <text class="text-base font-semibold text-ink">请假申请</text>
            <text class="text-xs text-ink-3">{{ leaveList.length }}</text>
          </view>
          <empty-state v-if="!leaveList.length" text="暂无请假申请" inline />
          <request-card
            v-for="r in leaveList"
            :key="r.leave_id"
            :record="r"
            kind="leave"
            :tab="tab"
            @action="onCardAction('leave', $event)"
          />
        </view>

        <view class="mb-2">
          <view class="flex items-center gap-1.5 px-0.5 mb-2">
            <app-icon name="clock" :size="15" tone="ink-2" />
            <text class="text-base font-semibold text-ink">补卡申请</text>
            <text class="text-xs text-ink-3">{{ makeupList.length }}</text>
          </view>
          <empty-state v-if="!makeupList.length" text="暂无补卡申请" inline />
          <request-card
            v-for="r in makeupList"
            :key="r.makeup_id"
            :record="r"
            kind="makeup"
            :tab="tab"
            @action="onCardAction('makeup', $event)"
          />
        </view>

        <text class="block px-1 pt-1.5 text-2xs text-ink-4 leading-relaxed">
          共 {{ leaveList.length + makeupList.length }} 条记录 · 请假按工作日计，周末不计天数；补卡只可补最近 7 天、每月最多 3 次。已批准的请假日不算缺卡，也不计入应出勤。
        </text>
      </template>
    </view>

    <leave-form
      :open="sheet === 'leave'"
      :today="today"
      :submitting="submitting"
      @close="sheet = ''"
      @submit="doLeave"
    />

    <makeup-form
      :open="sheet === 'makeup'"
      :today="today"
      :min-date="makeupMinDate"
      :submitting="submitting"
      @close="sheet = ''"
      @submit="doMakeup"
    />

    <approve-form
      :open="sheet === 'approve'"
      :action="approval.action"
      @close="sheet = ''"
      @submit="doApprove"
    />
  </view>
</template>

<script>
import PageHeader from "@/components/page-header.vue";
import AppIcon from "@/components/app-icon.vue";
import EmptyState from "@/components/empty-state.vue";
import Skeleton from "@/components/skeleton.vue";
import RequestCard from "./components/request-card.vue";
import LeaveForm from "./components/leave-form.vue";
import MakeupForm from "./components/makeup-form.vue";
import ApproveForm from "./components/approve-form.vue";
import {
  getMe,
  getLeaveList,
  getMakeupList,
  submitLeave,
  submitMakeup,
  approveLeave,
  approveMakeup,
  cancelLeave,
  cancelMakeup,
} from "@/api/oa";
import { bjYmd } from "@/utils/beijing";
import { getToken } from "@/utils/storage";

/**
 * 请假与补卡（页面层）。
 *
 * 卡片、三个弹层（请假/补卡/审批）都在 components/ 里，各自管自己的草稿与校验；
 * 本页只做：三档列表取数、范围切换、把组件事件转成接口调用。
 */
export default {
  components: { PageHeader, AppIcon, EmptyState, Skeleton, RequestCard, LeaveForm, MakeupForm, ApproveForm },
  data() {
    const today = bjYmd(Date.now());
    const min = bjYmd(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return {
      me: {},
      tab: "mine",
      scope: "team",
      loading: true,
      submitting: false,
      leaveList: [],
      makeupList: [],
      sheet: "",
      today,
      makeupMinDate: min,
      approval: { kind: "", id: "", action: "approve" },
    };
  },
  computed: {
    canReview() {
      return Boolean(this.me.can_view_team);
    },
    canAll() {
      return Boolean(this.me.can_view_all);
    },
    tabs() {
      const list = [{ label: "我的申请", value: "mine" }];
      if (this.canReview) list.push({ label: "待我审批", value: "pending" }, { label: "已处理", value: "done" });
      return list;
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
    async init() {
      try {
        this.me = await getMe();
      } catch (e) {
        /* 身份失败不影响列表 */
      }
      await this.load();
    },
    async load() {
      this.loading = true;
      const listScope = this.tab === "mine" ? "mine" : this.scope;
      const listStatus = this.tab === "pending" ? "pending" : undefined;
      try {
        const [lv, mk] = await Promise.all([
          getLeaveList({ scope: listScope, status: listStatus }),
          getMakeupList({ scope: listScope, status: listStatus }),
        ]);
        let leaves = lv.list || [];
        let makeups = mk.list || [];
        if (this.tab === "done") {
          leaves = leaves.filter((x) => x.status !== "pending");
          makeups = makeups.filter((x) => x.status !== "pending");
        }
        this.leaveList = leaves;
        this.makeupList = makeups;
      } catch (e) {
        this.leaveList = [];
        this.makeupList = [];
        uni.showToast({ title: e.message || "加载失败", icon: "none" });
      } finally {
        this.loading = false;
      }
    },
    switchTab(value) {
      if (this.tab === value) return;
      this.tab = value;
      this.load();
    },
    switchScope(value) {
      if (this.scope === value) return;
      this.scope = value;
      this.load();
    },
    openSheet(kind) {
      this.sheet = kind;
    },
    /** 卡片上的动作：撤销 / 同意 / 拒绝 */
    onCardAction(kind, { key, record }) {
      const id = kind === "leave" ? record.leave_id : record.makeup_id;
      if (key === "cancel") {
        this.onCancel(kind, id);
        return;
      }
      this.approval = { kind, id, action: key };
      this.sheet = "approve";
    },
    async doLeave(payload) {
      if (this.submitting) return;
      this.submitting = true;
      try {
        await submitLeave(payload);
        uni.showToast({ title: "请假申请已提交，等待上级审批", icon: "none" });
        this.sheet = "";
        await this.load();
      } catch (e) {
        uni.showToast({ title: e.message || "提交失败", icon: "none" });
      } finally {
        this.submitting = false;
      }
    },
    async doMakeup(payload) {
      if (this.submitting) return;
      this.submitting = true;
      try {
        await submitMakeup(payload);
        uni.showToast({ title: "补卡申请已提交，等待上级审批", icon: "none" });
        this.sheet = "";
        await this.load();
      } catch (e) {
        uni.showToast({ title: e.message || "提交失败", icon: "none" });
      } finally {
        this.submitting = false;
      }
    },
    async doApprove(comment) {
      const { kind, id, action } = this.approval;
      if (!id) return;
      try {
        if (kind === "leave") await approveLeave({ leaveId: id, action, comment });
        else await approveMakeup({ makeupId: id, action, comment });
        uni.showToast({ title: action === "approve" ? "已通过" : "已拒绝", icon: "none" });
        this.sheet = "";
        await this.load();
      } catch (e) {
        uni.showToast({ title: e.message || "审批失败", icon: "none" });
      }
    },
    async onCancel(kind, id) {
      const ok = await new Promise((resolve) => uni.showModal({ title: "撤销申请", content: "确定撤销这条申请吗？", success: (r) => resolve(r.confirm) }));
      if (!ok) return;
      try {
        if (kind === "leave") await cancelLeave(id);
        else await cancelMakeup(id);
        uni.showToast({ title: "已撤销", icon: "none" });
        await this.load();
      } catch (e) {
        uni.showToast({ title: e.message || "撤销失败", icon: "none" });
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
