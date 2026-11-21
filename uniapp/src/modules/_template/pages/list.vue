<template>
  <page-shell title="模块列表（模板）">
    <view class="tpl">
      <view class="tpl__tip">
        <text class="tpl__tip-text">这是骨架模板：复制 modules/_template 后改成你的业务，别直接改这里。</text>
      </view>

      <view class="tpl__search">
        <input v-model="keyword" class="tpl__input" placeholder="搜索" placeholder-class="tpl__ph" confirm-type="search" @confirm="load" />
      </view>

      <view v-if="loading" class="tpl__empty"><text>加载中…</text></view>
      <view v-else-if="!list.length" class="tpl__empty"><text>{{ error || "暂无数据" }}</text></view>

      <view v-for="row in list" :key="row.key" class="tpl__row" @tap="open(row)">
        <view class="tpl__row-main">
          <text class="tpl__row-title">{{ row.text }}</text>
          <text class="tpl__row-sub">{{ row.action }} ›</text>
        </view>
      </view>
    </view>
  </page-shell>
</template>

<script>
import PageShell from "@/components/page-shell.vue";
import { listRecords } from "@/modules/_template/api/index";

/**
 * 列表页模板：只做「取数 → 渲染 → 跳详情」，规则放 definition，校验放表单页。
 * 真接入时把 listRecords 换成业务接口，并补上筛选条与分页（onReachBottom）。
 */
export default {
  components: { PageShell },
  data() {
    return { keyword: "", list: [], loading: true, error: "" };
  },
  onShow() {
    this.load();
  },
  methods: {
    async load() {
      this.loading = true;
      this.error = "";
      try {
        const data = await listRecords({ page: 1, pageSize: 20, keyword: this.keyword.trim() });
        this.list = (data.list || []).map((item, i) => ({
          key: item.key || item.id || i,
          text: item.text || item.title || "未命名",
          action: item.action || "查看",
          raw: item,
        }));
      } catch (e) {
        this.list = [];
        this.error = e.message || "加载失败";
      } finally {
        this.loading = false;
      }
    },
    open(row) {
      // 详情页参数统一 encodeURIComponent，避免标题里带 & ? 破坏 query
      uni.navigateTo({ url: `/pages/example-detail/index?id=${encodeURIComponent(String(row.key))}` });
    },
  },
};
</script>

<style scoped>
.tpl {
  padding: 12px;
}

.tpl__tip {
  background: var(--warn-soft);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
}

.tpl__tip-text {
  font-size: 11px;
  color: var(--warn-text);
  line-height: 1.5;
}

.tpl__search {
  margin-bottom: 10px;
}

.tpl__input {
  height: 36px;
  padding: 0 12px;
  border-radius: 8px;
  background: #fff;
  font-size: 13px;
}

.tpl__ph {
  color: var(--ink-4);
}

.tpl__row {
  background: #fff;
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 8px;
}

.tpl__row-main {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.tpl__row-title {
  font-size: 14px;
  color: var(--ink);
}

.tpl__row-sub {
  font-size: 11px;
  color: var(--primary);
}

.tpl__empty {
  padding: 40px 0;
  text-align: center;
  font-size: 12px;
  color: var(--ink-3);
}
</style>
