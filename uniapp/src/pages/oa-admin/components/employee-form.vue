<template>
  <bottom-sheet :open="open" :title="title" @close="$emit('close')">
    <form-field label="IM 账号" hint="只能从已注册的 IM 账号里选，昵称会自动带入">
      <picker v-if="!editing" mode="selector" :range="imLabels" :value="imIndex" @change="onImChange">
        <view class="oa-input leading-10">{{ imLabel || "选择已注册的 IM 账号" }}</view>
      </picker>
      <view v-else class="h-10 leading-10 px-3 rounded-ctl bg-fill-2 text-md text-ink-3">{{ form.user_id }}</view>
    </form-field>

    <form-field label="姓名">
      <input v-model="form.real_name" class="oa-input" placeholder="如：李然" maxlength="20" />
    </form-field>

    <form-field label="部门">
      <input v-model="form.department" class="oa-input" placeholder="如：技术部" maxlength="20" />
    </form-field>

    <form-field label="岗位">
      <input v-model="form.position" class="oa-input" placeholder="如：前端工程师（可不填）" maxlength="30" />
    </form-field>

    <form-field label="角色">
      <picker mode="selector" :range="roleOptionLabels" :value="formRoleIndex" @change="onFormRoleChange">
        <view class="oa-input leading-10">{{ roleText }} · {{ roleHint }}</view>
      </picker>
    </form-field>

    <form-field label="直属上级" hint="选领导即为顶层；留空也是顶层（例如公司负责人）">
      <picker mode="selector" :range="managerLabels" :value="managerIndex" @change="onManagerChange">
        <view class="oa-input leading-10">{{ managerLabel }}</view>
      </picker>
    </form-field>

    <view class="flex items-center justify-between py-1">
      <text class="text-sm text-ink-2">管理员</text>
      <toggle-switch :on="form.is_admin" @change="form.is_admin = !form.is_admin" />
    </view>

    <template #actions>
      <view class="oa-btn flex-1" @tap="$emit('close')"><text class="text-md text-ink">取消</text></view>
      <view class="oa-btn-primary flex-1" @tap="submit">
        <text class="text-md text-white font-medium">{{ submitting ? "保存中…" : "保存" }}</text>
      </view>
    </template>
  </bottom-sheet>
</template>

<script>
import BottomSheet from "@/components/bottom-sheet.vue";
import FormField from "@/components/form-field.vue";
import ToggleSwitch from "./toggle-switch.vue";

const ROLE_TEXT = { employee: "员工", manager: "组长", leader: "领导", hr: "HR", admin: "管理员" };
const ROLE_HINT = {
  employee: "只能看自己的日报",
  manager: "看组员、点评、上报",
  leader: "看本团队、点评、归档",
};
const ROLE_OPTIONS = [
  { value: "employee", label: "员工" },
  { value: "manager", label: "组长" },
  { value: "leader", label: "领导" },
];

function emptyForm() {
  return { user_id: "", real_name: "", department: "", position: "", role: "employee", manager_id: "", is_admin: false };
}

/**
 * 添加 / 编辑员工弹层（bottom-sheet + form-field）。
 *
 * 自己维护草稿与校验（与 leave-form.vue 同一套做法）：
 * 校验通过才 emit('submit', payload)，页面拿到 payload 只负责调 saveEmployee。
 * 直属上级候选由页面传 employees（当前列表）进来，编辑时排除自己。
 */
export default {
  name: "EmployeeForm",
  components: { BottomSheet, FormField, ToggleSwitch },
  props: {
    open: { type: Boolean, default: false },
    editing: { type: Object, default: null },
    imUsers: { type: Array, default: () => [] },
    employees: { type: Array, default: () => [] },
    submitting: { type: Boolean, default: false },
  },
  emits: ["close", "submit"],
  data() {
    return { form: emptyForm() };
  },
  computed: {
    title() {
      return this.editing ? "编辑员工" : "添加员工";
    },
    imLabels() {
      return this.imUsers.map((u) => `${u.nickname || u.user_id} ${u.phone_number || ""}${u.has_profile ? "（已有档案）" : ""}`);
    },
    imIndex() {
      const i = this.imUsers.findIndex((u) => u.user_id === this.form.user_id);
      return i < 0 ? 0 : i;
    },
    imLabel() {
      return this.imLabels[this.imIndex] || "";
    },
    roleOptionLabels() {
      return ROLE_OPTIONS.map((r) => `${r.label} · ${ROLE_HINT[r.value]}`);
    },
    formRoleIndex() {
      const i = ROLE_OPTIONS.findIndex((r) => r.value === this.form.role);
      return i < 0 ? 0 : i;
    },
    roleText() {
      return ROLE_TEXT[this.form.role] || this.form.role;
    },
    roleHint() {
      return ROLE_HINT[this.form.role] || "";
    },
    managerOptions() {
      return this.employees
        .filter((e) => !e.disabled && (e.role === "manager" || e.role === "leader"))
        .filter((e) => !this.editing || e.user_id !== this.editing.user_id)
        .map((e) => ({ value: e.user_id, label: `${e.real_name}（${ROLE_TEXT[e.role] || e.role}${e.department ? " · " + e.department : ""}）` }));
    },
    managerLabels() {
      return ["（顶层，无上级）", ...this.managerOptions.map((m) => m.label)];
    },
    managerIndex() {
      const i = this.managerOptions.findIndex((m) => m.value === this.form.manager_id);
      return i < 0 ? 0 : i + 1;
    },
    managerLabel() {
      const i = this.managerIndex;
      return this.managerLabels[i] || this.managerLabels[0];
    },
  },
  watch: {
    // 每次打开按 editing 重置草稿，避免上一次的输入残留
    open(val) {
      if (val) this.form = this.fromEmployee(this.editing);
    },
  },
  methods: {
    fromEmployee(e) {
      if (!e) return emptyForm();
      return {
        user_id: e.user_id,
        real_name: e.real_name,
        department: e.department,
        position: e.position || "",
        role: e.role,
        manager_id: e.manager_id || "",
        is_admin: Boolean(e.is_admin),
      };
    },
    onImChange(e) {
      const idx = Number(e.detail.value);
      const picked = this.imUsers[idx];
      if (!picked) return;
      this.form.user_id = picked.user_id;
      this.form.real_name = picked.nickname || "";
    },
    onFormRoleChange(e) {
      const idx = Number(e.detail.value);
      this.form.role = ROLE_OPTIONS[idx] ? ROLE_OPTIONS[idx].value : "employee";
    },
    onManagerChange(e) {
      const idx = Number(e.detail.value);
      this.form.manager_id = idx === 0 ? "" : (this.managerOptions[idx - 1] || {}).value || "";
    },
    submit() {
      const f = this.form;
      if (!f.user_id) {
        uni.showToast({ title: "请选择 IM 账号", icon: "none" });
        return;
      }
      if (!String(f.real_name || "").trim()) {
        uni.showToast({ title: "请填姓名", icon: "none" });
        return;
      }
      if (!String(f.department || "").trim()) {
        uni.showToast({ title: "请填部门", icon: "none" });
        return;
      }
      this.$emit("submit", {
        user_id: f.user_id,
        real_name: f.real_name.trim(),
        department: f.department.trim(),
        position: (f.position || "").trim(),
        role: f.role,
        manager_id: f.manager_id || "",
        is_admin: Boolean(f.is_admin),
      });
    },
  },
};
</script>
