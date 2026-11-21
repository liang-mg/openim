<template>
  <view>
    <skeleton v-if="loading" :lines="6" :height="16" />
    <empty-state v-else-if="!list.length" :text="emptyText" name="users" />

    <view v-else>
      <employee-row
        v-for="e in list"
        :key="e.user_id"
        :employee="e"
        :manager-name="managerName(e)"
        @edit="$emit('edit', $event)"
        @toggle="$emit('toggle', $event)"
      />
    </view>
  </view>
</template>

<script>
import Skeleton from "@/components/skeleton.vue";
import EmptyState from "@/components/empty-state.vue";
import EmployeeRow from "./employee-row.vue";

/**
 * 员工列表容器：加载骨架 / 空态 / 员工行循环。
 *
 * props：list（员工数组）、loading（首开加载中，加载时用骨架盖住旧列表）、
 * emptyText（“没有匹配的成员”与“还没有成员，先添加一个”的文案差异由页面拼好传入）。
 * emits：edit / toggle —— 原样转发 employee-row 的事件；弹层打开、停用启用仍由页面编排。
 * 上级姓名在本组件里用 list 反查，页面不再派生 managerName 数据。
 * `.emp / .emp__op / .emp__op--ok` 仍由 employee-row 渲染，E2E 选择器不受影响。
 */
export default {
  name: "EmployeeList",
  components: { Skeleton, EmptyState, EmployeeRow },
  props: {
    list: { type: Array, default: () => [] },
    loading: { type: Boolean, default: false },
    emptyText: { type: String, default: "还没有成员，先添加一个" },
  },
  emits: ["edit", "toggle"],
  methods: {
    managerName(e) {
      if (!e.manager_id) return "—";
      const hit = this.list.find((x) => x.user_id === e.manager_id);
      return hit ? hit.real_name : e.manager_id;
    },
  },
};
</script>
