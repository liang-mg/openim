<template>
  <page-shell title="模块详情（模板）">
    <view class="tpl">
      <view v-if="loading" class="tpl__empty"><text>加载中…</text></view>
      <view v-else-if="!record" class="tpl__empty"><text>{{ error || "记录不存在" }}</text></view>

      <template v-else>
        <view class="tpl__card">
          <view v-for="field in fields" :key="field.key" class="tpl__field">
            <text class="tpl__label">{{ field.label }}</text>
            <text class="tpl__value">{{ record[field.key] === "" || record[field.key] === undefined ? "—" : record[field.key] }}</text>
          </view>
        </view>

        <view class="tpl__actions">
          <view v-for="act in actions" :key="act.key" class="tpl__btn" :class="`tpl__btn--${act.tone}`" @tap="run(act)">
            <text class="tpl__btn-text">{{ act.label }}</text>
          </view>
        </view>
      </template>
    </view>
  </page-shell>
</template>

<script>
import PageShell from "@/components/page-shell.vue";
import { getRecord, runAction } from "@/modules/_template/api/index";
import { DETAIL_FIELDS, actionsOf } from "@/modules/_template/definition";

/**
 * 详情页模板：字段从 definition 读，动作按状态过滤。
 * 真正的「能不能点」以服务端 allowedActions 为准，这里只做展示。
 */
export default {
  components: { PageShell },
  data() {
    return { id: "", record: null, loading: true, error: "", fields: DETAIL_FIELDS, actions: [] };
  },
  onLoad(options) {
    this.id = decodeURIComponent((options && options.id) || "");
    this.load();
  },
  methods: {
    async load() {
      this.loading = true;
      this.error = "";
      try {
        this.record = await getRecord(this.id);
        this.actions = this.record ? actionsOf(this.record.status) : [];
      } catch (e) {
        this.record = null;
        this.error = e.message || "加载失败";
      } finally {
        this.loading = false;
      }
    },
    async run(act) {
      try {
        this.record = await runAction(this.id, act.key);
        this.actions = actionsOf(this.record.status);
        uni.showToast({ title: `${act.label}成功`, icon: "none" });
      } catch (e) {
        uni.showToast({ title: e.message || "操作失败", icon: "none" });
      }
    },
  },
};
</script>

<style scoped>
.tpl {
  padding: 12px;
}

.tpl__card {
  background: #fff;
  border-radius: 12px;
  padding: 12px;
}

.tpl__field {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid #f2f4f8;
}

.tpl__field:last-child {
  border-bottom: none;
}

.tpl__label {
  font-size: 12px;
  color: var(--ink-3);
  flex: 0 0 84px;
}

.tpl__value {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: 13px;
  color: var(--ink);
}

.tpl__actions {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}

.tpl__btn {
  flex: 1;
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--fill-2);
}

.tpl__btn--primary {
  background: var(--brand);
}

.tpl__btn--danger {
  background: var(--danger);
}

.tpl__btn-text {
  font-size: 14px;
  color: #fff;
}

.tpl__btn:not(.tpl__btn--primary):not(.tpl__btn--danger) .tpl__btn-text {
  color: var(--ink);
}

.tpl__empty {
  padding: 40px 0;
  text-align: center;
  font-size: 12px;
  color: var(--ink-3);
}
</style>
