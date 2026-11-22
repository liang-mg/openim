<template>
  <view class="app-page">
    <page-header title="员工与权限" @back="back">
      <template #right>
        <text v-if="canManage" class="text-2xs text-white bg-white/20 rounded px-1.5 py-0.5">管理员</text>
        <text class="text-sm text-white/90">{{ user.displayName }}</text>
      </template>
    </page-header>

    <!-- 非管理员 -->
    <empty-state v-if="!canManage && !loading" text="仅管理员可以维护员工与权限" name="shield" />

    <view v-else class="px-3 pt-3 pb-7">
      <page-head @add="openAdd" />

      <!-- 考勤规则 -->
      <rule-card :rule="rule" :saving="ruleSaving" @change="setRuleField" @save="doSaveRule" />

      <!-- 筛选 -->
      <admin-toolbar
        :keyword="keyword"
        :dept-options="deptOptions"
        :dept-index="deptIndex"
        :dept-filter="deptFilter"
        :role-labels="roleLabels"
        :role-index="roleIndex"
        :role-filter-text="roleFilterText"
        :include-disabled="includeDisabled"
        :count="list.length"
        @update:keyword="keyword = $event"
        @search="load"
        @dept-change="onDeptChange"
        @role-change="onRoleChange"
        @toggle-disabled="toggleIncludeDisabled"
      />

      <employee-list :list="list" :loading="loading" :empty-text="emptyText" @edit="openEdit" @toggle="toggleDisabled" />

      <text class="block pt-1.5 px-1 text-2xs text-ink-4 leading-relaxed">
        角色决定可见范围：员工只看自己；组长看直属组员；领导看下属及其下属（本团队）。管理员与业务角色相互独立，领导可以兼任。
      </text>
    </view>

    <!-- 添加 / 编辑 -->
    <employee-form
      :open="sheetOpen"
      :editing="editing"
      :im-users="imUsers"
      :employees="list"
      :submitting="saving"
      @close="sheetOpen = false"
      @submit="doSubmit"
    />
  </view>
</template>

<script>
import PageHeader from "@/components/page-header.vue";
import EmptyState from "@/components/empty-state.vue";
import PageHead from "./components/page-head.vue";
import RuleCard from "./components/rule-card.vue";
import EmployeeList from "./components/employee-list.vue";
import AdminToolbar from "./components/toolbar.vue";
import EmployeeForm from "./components/employee-form.vue";
import { getMe, getEmployeeList, getIMUserCandidates, saveEmployee, setEmployeeDisabled, getAttendanceRule, saveAttendanceRule } from "@/api/oa";
import { useUserStore } from "@/store/user";
import { getToken } from "@/utils/storage";

const ROLE_TEXT = { employee: "员工", manager: "组长", leader: "领导", hr: "HR", admin: "管理员" };
const ROLE_OPTIONS = [
  { value: "employee", label: "员工" },
  { value: "manager", label: "组长" },
  { value: "leader", label: "领导" },
];

/**
 * 员工与权限（页面层）。对齐 PC 端 frontend/src/pages/oa-admin/index.tsx：
 *   考勤规则（管理员可改）+ 员工列表（搜索/部门/角色/含停用筛选）+ 添加编辑 + 停用启用。
 * 仅 is_admin 可进，非管理员显示提示。
 *
 * 拆分布局（每个文件 ≤200 非空行）：
 *   components/page-head.vue      说明条 + 添加入口（抛 add）
 *   components/rule-card.vue      考勤规则卡片（渲染 + change/save 事件）
 *   components/employee-row.vue   员工一行（头像/角色/上级/编辑停用）
 *   components/employee-list.vue  列表容器（加载/空态/行循环，抛 edit/toggle）
 *   components/toolbar.vue        搜索/部门/角色筛选 + 含已停用开关 + 人数
 *   components/employee-form.vue  添加/编辑弹层（自己管草稿与校验）
 *   components/toggle-switch.vue  开关（保留 .switch 类名）
 * 本页只做：取数、增删改接口调用、弹层打开/关闭编排。
 */
export default {
  components: {
    PageHeader,
    EmptyState,
    PageHead,
    RuleCard,
    EmployeeList,
    AdminToolbar,
    EmployeeForm,
  },
  data() {
    return {
      me: {},
      loading: true,
      list: [],
      departments: [],
      keyword: "",
      deptFilter: "",
      roleFilter: "",
      includeDisabled: false,
      rule: null,
      ruleSaving: false,
      sheetOpen: false,
      editing: null,
      saving: false,
      imUsers: [],
    };
  },
  computed: {
    user() {
      return useUserStore();
    },
    canManage() {
      return Boolean(this.me.is_admin);
    },
    deptOptions() {
      return ["全部", ...this.departments];
    },
    deptIndex() {
      const i = this.deptOptions.indexOf(this.deptFilter || "全部");
      return i < 0 ? 0 : i;
    },
    roleLabels() {
      return ["全部", ...ROLE_OPTIONS.map((r) => r.label)];
    },
    roleIndex() {
      if (!this.roleFilter) return 0;
      const i = ROLE_OPTIONS.findIndex((r) => r.value === this.roleFilter);
      return i < 0 ? 0 : i + 1;
    },
    roleFilterText() {
      return this.roleFilter ? ROLE_TEXT[this.roleFilter] || this.roleFilter : "角色：全部";
    },
    emptyText() {
      return this.keyword || this.deptFilter || this.roleFilter ? "没有匹配的成员" : "还没有成员，先添加一个";
    },
  },
  onShow() {
    if (!getToken()) {
      uni.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.user.fetchProfile().catch(() => {});
    this.init();
  },
  methods: {
    async init() {
      this.loading = true;
      try {
        this.me = await getMe();
        if (this.canManage) {
          await Promise.all([this.load(), this.loadRule()]);
        }
      } catch (e) {
        uni.showToast({ title: e.message || "加载身份失败", icon: "none" });
      } finally {
        this.loading = false;
      }
    },
    async load() {
      try {
        const res = await getEmployeeList({
          keyword: this.keyword.trim() || undefined,
          department: this.deptFilter || undefined,
          role: this.roleFilter || undefined,
          includeDisabled: this.includeDisabled,
        });
        this.list = res.list || [];
        this.departments = res.departments || [];
      } catch (e) {
        uni.showToast({ title: e.message || "加载失败", icon: "none" });
      }
    },
    async loadRule() {
      try {
        this.rule = await getAttendanceRule();
      } catch (e) {
        /* 规则读不到不阻塞员工列表 */
      }
    },
    setRuleField(key, value) {
      if (!this.rule) return;
      const numeric = ["late_grace", "makeup_max_days", "makeup_max_month"].includes(key);
      this.rule[key] = numeric ? Number(value || 0) : value;
    },
    async doSaveRule() {
      if (!this.rule || this.ruleSaving) return;
      this.ruleSaving = true;
      try {
        const saved = await saveAttendanceRule({
          work_on_time: this.rule.work_on_time,
          work_off_time: this.rule.work_off_time,
          late_grace: Number(this.rule.late_grace) || 0,
          earliest_on: this.rule.earliest_on,
          need_photo: Boolean(this.rule.need_photo),
          need_location: Boolean(this.rule.need_location),
          makeup_max_days: Number(this.rule.makeup_max_days) || 0,
          makeup_max_month: Number(this.rule.makeup_max_month) || 0,
        });
        this.rule = saved || this.rule;
        uni.showToast({ title: "考勤规则已保存，之后的打卡按新规则判定", icon: "none" });
      } catch (e) {
        uni.showToast({ title: e.message || "保存失败", icon: "none" });
      } finally {
        this.ruleSaving = false;
      }
    },
    onDeptChange(idx) {
      const value = this.deptOptions[idx] || "全部";
      this.deptFilter = value === "全部" ? "" : value;
      this.load();
    },
    onRoleChange(idx) {
      this.roleFilter = idx === 0 ? "" : ROLE_OPTIONS[idx - 1].value;
      this.load();
    },
    toggleIncludeDisabled() {
      this.includeDisabled = !this.includeDisabled;
      this.load();
    },
    async openAdd() {
      this.editing = null;
      this.sheetOpen = true;
      try {
        this.imUsers = (await getIMUserCandidates()) || [];
      } catch (e) {
        this.imUsers = [];
        uni.showToast({ title: e.message || "读取 IM 账号失败", icon: "none" });
      }
    },
    async openEdit(e) {
      this.editing = e;
      this.sheetOpen = true;
      try {
        this.imUsers = (await getIMUserCandidates()) || [];
      } catch (err) {
        this.imUsers = [];
      }
    },
    async doSubmit(payload) {
      if (this.saving) return;
      this.saving = true;
      try {
        await saveEmployee(payload);
        uni.showToast({ title: this.editing ? "已保存" : "已添加，该成员现在可以打卡写日报了", icon: "none" });
        this.sheetOpen = false;
        await this.load();
      } catch (e) {
        uni.showToast({ title: e.message || "保存失败", icon: "none" });
      } finally {
        this.saving = false;
      }
    },
    async toggleDisabled(e) {
      const next = !e.disabled;
      const verb = next ? "停用" : "启用";
      const content = next
        ? "停用后该成员看不到 OA 入口、不再参与汇报链；历史日报与点评全部保留，可随时重新启用。"
        : "启用后该成员恢复打卡与写日报的能力，并重新计入上级的查阅范围。";
      const confirmed = await new Promise((resolve) =>
        uni.showModal({ title: `${verb}${e.real_name}？`, content, confirmText: verb, success: (r) => resolve(r.confirm) })
      );
      if (!confirmed) return;
      try {
        await setEmployeeDisabled(e.user_id, next);
        uni.showToast({ title: `已${verb}`, icon: "none" });
        await this.load();
      } catch (err) {
        uni.showToast({ title: err.message || `${verb}失败`, icon: "none" });
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
