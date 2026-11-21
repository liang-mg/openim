<template>
  <view class="emp flex items-center gap-2.5 bg-white rounded-card p-3 mb-2.5" :class="{ 'opacity-55': employee.disabled }">
    <oim-avatar :text="(employee.real_name || '?').slice(0, 1)" :size="40" />

    <view class="flex-1 min-w-0">
      <view class="flex items-center gap-1.5 flex-wrap">
        <text class="text-md font-semibold text-ink">{{ employee.real_name }}</text>
        <text v-if="employee.is_admin" class="oa-tag oa-tag-warn">管理员</text>
        <text v-if="employee.disabled" class="oa-tag bg-fill-2 text-ink-3">已停用</text>
        <text class="ml-auto text-2xs" :style="{ color: roleColor }">{{ roleText }}</text>
      </view>
      <text class="block mt-0.5 text-2xs text-ink-4">{{ employee.phone_number || employee.user_id }}</text>
      <text class="block mt-0.5 text-xs text-ink-3">{{ employee.department || "未分配部门" }}{{ employee.position ? ` · ${employee.position}` : "" }}</text>
      <text class="block mt-0.5 text-2xs text-ink-4">上级：{{ managerName }}</text>
    </view>

    <view class="flex flex-col gap-2 items-end">
      <text class="emp__op text-xs text-brand" @tap="$emit('edit', employee)">编辑</text>
      <text
        class="emp__op text-xs"
        :class="employee.disabled ? 'emp__op--ok text-ok-text' : 'emp__op--danger text-danger'"
        @tap="$emit('toggle', employee)"
      >
        {{ employee.disabled ? "启用" : "停用" }}
      </text>
    </view>
  </view>
</template>

<script>
import OimAvatar from "@/components/oim-avatar.vue";

const ROLE_TEXT = { employee: "员工", manager: "组长", leader: "领导", hr: "HR", admin: "管理员" };
const ROLE_COLOR = { employee: "var(--ink-2)", manager: "var(--primary)", leader: "#7c3aed", hr: "#0891b2", admin: "#c2410c" };

/**
 * 员工一行（头像 / 姓名 / 角色标签 / 账号 / 部门·岗位 / 上级 / 编辑停用）。
 *
 * 保留 .emp / .emp__op / .emp__op--ok 类名：E2E 用 `.emp` 数人数、
 * 用 `.emp__op` 点编辑、用 `.emp__op--ok` 点启用。
 * 角色文案与颜色只用于展示，权限仍由服务端判。
 */
export default {
  name: "EmployeeRow",
  components: { OimAvatar },
  props: {
    employee: { type: Object, required: true },
    managerName: { type: String, default: "—" },
  },
  emits: ["edit", "toggle"],
  computed: {
    roleText() {
      return ROLE_TEXT[this.employee.role] || this.employee.role;
    },
    roleColor() {
      return ROLE_COLOR[this.employee.role] || "var(--ink-2)";
    },
  },
};
</script>
