<template>
  <view class="app-page notif-page">
    <page-header title="通知">
      <template #right>
        <view v-if="unread > 0" class="flex items-center gap-2">
          <view class="notif-unread min-w-4 h-4 px-1 rounded-pill bg-white flex items-center justify-center">
            <text class="text-2xs text-brand font-semibold leading-none">{{ unreadText }}</text>
          </view>
          <view class="notif-mark-all h-7 px-2 rounded-pill bg-brand-dark flex items-center gap-1" @tap="markAll">
            <app-icon name="check" :size="12" tone="card" />
            <text class="text-xs text-white">{{ markingAll ? "处理中" : "全部已读" }}</text>
          </view>
        </view>
      </template>
    </page-header>

    <view class="px-3 pt-3 pb-7">
      <view class="notif-tabs flex items-center gap-1 p-1 rounded-ctl bg-white mb-3">
        <view
          v-for="t in tabs"
          :key="t.value"
          class="notif-tab flex-1 h-8 rounded-ctl flex items-center justify-center"
          :class="tab === t.value ? 'notif-tab--active bg-brand-soft' : ''"
          @tap="switchTab(t.value)"
        >
          <text class="text-base" :class="tab === t.value ? 'text-brand font-semibold' : 'text-ink-3'">{{ t.label }}</text>
        </view>
      </view>

      <view v-if="loading" class="oa-card">
        <skeleton :lines="4" :height="16" />
      </view>

      <empty-state v-else-if="error" :text="error" name="bell" />

      <empty-state v-else-if="!visibleList.length" :text="emptyText" name="bell" />

      <view v-else class="notif-list">
        <notif-row v-for="item in visibleList" :key="item.notification_id" :notice="item" @read="markRead" />
      </view>
    </view>
  </view>
</template>

<script>
import PageHeader from "@/components/page-header.vue";
import AppIcon from "@/components/app-icon.vue";
import EmptyState from "@/components/empty-state.vue";
import Skeleton from "@/components/skeleton.vue";
import NotifRow from "./components/notif-row.vue";
import { getNotifications, readNotifications } from "@/api/oa";
import { peek, put, clear } from "@/utils/swr";
import { getToken } from "@/utils/storage";

const CACHE_PREFIX = "oa:notifications:";

/**
 * 通知中心（只读列表 + 点击已读）。对齐 PC 端 frontend/src/pages/notifications：
 *   默认「未读」tab（getNotifications()） → 点一条调 readNotifications(id) 并本地置已读；
 *   切换「全部」tab（getNotifications(true)） → 已读历史保留，但不再画未读圆点。
 * 移动端差异：PC 的「标为已读 / 查看记录」按钮改成「点整行标为已读」（不跳业务页）；
 * 顶部右侧常驻未读数与「全部已读」（仅未读 > 0 时出现），全部已读后不整页刷新。
 */
export default {
  components: { PageHeader, AppIcon, EmptyState, Skeleton, NotifRow },
  data() {
    return {
      tab: "unread",
      tabs: [
        { value: "unread", label: "未读" },
        { value: "all", label: "全部" },
      ],
      loading: true,
      error: "",
      list: [],
      unread: 0,
      markingId: "",
      markingAll: false,
    };
  },
  computed: {
    visibleList() {
      // 「未读」tab 只渲染未读行：本地置已读后立即消失，不需要整页刷新
      return this.tab === "unread" ? this.list.filter((n) => !n.read) : this.list;
    },
    emptyText() {
      return this.tab === "unread" ? "暂无未读通知" : "暂无通知";
    },
    unreadText() {
      return this.unread > 99 ? "99+" : String(this.unread);
    },
  },
  onShow() {
    if (!getToken()) {
      uni.reLaunch({ url: "/pages/login/index" });
      return;
    }
    // 先用上次结果铺列表（切回本页不闪白），再后台拉最新
    this.applyCache();
    this.load();
  },
  async onPullDownRefresh() {
    await this.load();
    uni.stopPullDownRefresh();
  },
  methods: {
    cacheKey(tab) {
      return `${CACHE_PREFIX}${tab || this.tab}`;
    },
    applyCache() {
      const cached = peek(this.cacheKey());
      if (!cached) return;
      this.list = cached.list || [];
      if (typeof cached.unread === "number") this.unread = cached.unread;
      this.loading = false;
    },
    saveCache() {
      put(this.cacheKey(), { list: this.list, unread: this.unread });
    },
    sortDesc(list) {
      return (list || []).slice().sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
    },
    async load() {
      const tab = this.tab;
      this.loading = !this.list.length;
      this.error = "";
      try {
        const data = await getNotifications(tab === "all");
        // 请求期间用户切了 tab：丢弃这次结果，避免旧 tab 的数据覆盖新 tab
        if (tab !== this.tab) return;
        const rows = this.sortDesc(data.list);
        this.list = rows;
        this.unread = Number(data.unread) || rows.filter((n) => !n.read).length;
        put(this.cacheKey(tab), { list: this.list, unread: this.unread });
      } catch (e) {
        if (tab !== this.tab) return;
        const message = e.message || "通知加载失败";
        if (this.list.length) uni.showToast({ title: message, icon: "none" });
        else this.error = message;
      } finally {
        if (tab === this.tab) this.loading = false;
      }
    },
    switchTab(value) {
      if (this.tab === value) return;
      this.tab = value;
      this.error = "";
      const cached = peek(this.cacheKey(value));
      this.list = cached ? cached.list || [] : [];
      if (cached && typeof cached.unread === "number") this.unread = cached.unread;
      this.load();
    },
    /** 本地置已读：改 read 标记 + 未读数减 1，不重新拉整页 */
    markLocally(ids) {
      const idSet = new Set(ids);
      this.list.forEach((n) => {
        if (idSet.has(n.notification_id)) n.read = true;
      });
      this.unread = Math.max(0, this.unread - idSet.size);
      // 另一个 tab 的缓存里还是旧状态，清掉避免切过去看到已读行仍是未读
      clear(this.cacheKey(this.tab === "unread" ? "all" : "unread"));
      this.saveCache();
    },
    async markRead(notice) {
      if (notice.read || this.markingId || this.markingAll) return;
      this.markingId = notice.notification_id;
      try {
        await readNotifications(notice.notification_id);
        this.markLocally([notice.notification_id]);
        uni.showToast({ title: "已标为已读", icon: "none", duration: 1200 });
      } catch (e) {
        uni.showToast({ title: e.message || "标记已读失败", icon: "none" });
      } finally {
        this.markingId = "";
      }
    },
    async markAll() {
      if (!this.unread || this.markingAll || this.markingId) return;
      this.markingAll = true;
      try {
        // 与 PC 一致：不传 id 表示全部已读
        await readNotifications();
        this.markLocally(this.list.filter((n) => !n.read).map((n) => n.notification_id));
        // 「未读」tab 里列表已清空，直接归零兜底
        this.unread = 0;
        this.saveCache();
        uni.showToast({ title: "已全部标为已读", icon: "none", duration: 1200 });
      } catch (e) {
        uni.showToast({ title: e.message || "全部已读失败", icon: "none" });
      } finally {
        this.markingAll = false;
      }
    },
  },
};
</script>
