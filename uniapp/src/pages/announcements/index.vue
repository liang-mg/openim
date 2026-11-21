<template>
  <view class="app-page">
    <page-header :title="detailOpen ? '公告详情' : '公告'" />

    <!-- 列表 -->
    <view v-if="!detailOpen" class="px-3 pt-3 pb-7">
      <skeleton v-if="loading" :lines="6" :height="18" />

      <empty-state v-else-if="error" :text="error" name="bell" />

      <empty-state v-else-if="!list.length" text="暂无公告" name="bell" />

      <view v-else>
        <announcement-row
          v-for="item in list"
          :key="item.announcement_id"
          :announcement="item"
          @open="openDetail"
        />
        <text class="block px-1 pt-1.5 text-2xs text-ink-4 leading-relaxed">
          共 {{ list.length }} 条公告 · 只读页面：移动端不提供发布、编辑与回执催办，回执仅作展示。
        </text>
      </view>
    </view>

    <!-- 详情 -->
    <view v-else class="px-3 pt-3 pb-7">
      <view class="inline-flex items-center gap-0.5 px-0.5 pb-2.5" @tap="closeDetail">
        <app-icon name="chevron-left" :size="14" color="var(--brand)" />
        <text class="detail-back__text text-base text-brand">返回列表</text>
      </view>

      <skeleton v-if="detailLoading" :lines="4" :height="16" />
      <empty-state v-else-if="detailError" :text="detailError" name="bell" />
      <announcement-detail v-else-if="detail" :announcement="detail" :receipts="receipts" />
    </view>
  </view>
</template>

<script>
import PageHeader from "@/components/page-header.vue";
import AppIcon from "@/components/app-icon.vue";
import EmptyState from "@/components/empty-state.vue";
import Skeleton from "@/components/skeleton.vue";
import AnnouncementRow from "./components/announcement-row.vue";
import AnnouncementDetail from "./components/announcement-detail.vue";
import { getPublishedAnnouncements, getAnnouncement, getAnnouncementReceipts, readAnnouncement } from "@/api/oa";
import { peek, put } from "@/utils/swr";
import { getToken } from "@/utils/storage";

/**
 * 公告（移动端只读）。逐块对齐 PC 端：
 *   列表 = frontend/src/pages/oa-admin/AnnouncementManagement.tsx 的「已发布公告」表格
 *          → getPublishedAnnouncements()（GET /admin/announcements，管理端接口）
 *   详情 = frontend/src/pages/announcements/index.tsx
 *          → getAnnouncement(id) + readAnnouncement(id)
 *   回执 = 同一表格的「查看回执」弹层，只读展示 → getAnnouncementReceipts(id)
 *
 * 移动端差异：PC 的列表页与回执弹层合成「列表 → 详情」两级；进入详情自动写本人阅读回执，
 * 失败静默（不阻断阅读）。发布 / 编辑 / 删除 / 催办一律不做。
 */
export default {
  components: { PageHeader, AppIcon, EmptyState, Skeleton, AnnouncementRow, AnnouncementDetail },
  data() {
    return {
      loading: true,
      error: "",
      list: [],
      detailOpen: false,
      selectedId: "",
      detailLoading: false,
      detailError: "",
      detail: null,
      receipts: null,
    };
  },
  onShow() {
    if (!getToken()) {
      uni.reLaunch({ url: "/pages/login/index" });
      return;
    }
    // 详情打开期间不重复刷列表（切后台再回来时保持当前详情）
    if (!this.detailOpen) this.loadList();
  },
  async onPullDownRefresh() {
    if (!this.detailOpen) await this.loadList();
    uni.stopPullDownRefresh();
  },
  methods: {
    async loadList() {
      // 先用上次结果把列表铺出来，再后台刷新：切回本页不出现「白屏 → 等请求」
      const cached = peek("announcements:list");
      if (cached) this.list = cached;
      this.loading = !this.list.length;
      this.error = "";
      try {
        const { list } = await getPublishedAnnouncements();
        this.list = list || [];
        put("announcements:list", this.list);
      } catch (e) {
        const raw = (e && e.message) || "公告加载失败";
        // 后端未升级时是 404：说清楚是"服务端还没这个接口"，别让人以为页面坏了
        const message = /404|请求失败/.test(raw) ? "当前服务端还没有公告接口（需升级后端），公告暂时只能看通知" : raw;
        if (this.list.length) uni.showToast({ title: message, icon: "none" });
        else this.error = message;
      } finally {
        this.loading = false;
      }
    },
    openDetail(item) {
      this.selectedId = item.announcement_id;
      this.detailOpen = true;
      this.detail = null;
      this.receipts = null;
      this.detailError = "";
      this.loadDetail();
    },
    async loadDetail() {
      const id = this.selectedId;
      this.detailLoading = true;
      try {
        const [detail, receipts] = await Promise.all([
          getAnnouncement(id),
          // 回执是发布人维度数据，无权查看时静默省略整块
          getAnnouncementReceipts(id).catch(() => null),
        ]);
        if (this.selectedId !== id) return;
        this.detail = detail || null;
        this.receipts = receipts || null;
        if (this.detail) {
          // 与 PC 一致：详情成功后立即写本人阅读回执；失败静默，不影响阅读
          readAnnouncement(id).catch(() => {});
        }
      } catch (e) {
        if (this.selectedId === id) this.detailError = (e && e.message) || "公告加载失败";
      } finally {
        if (this.selectedId === id) this.detailLoading = false;
      }
    },
    closeDetail() {
      this.detailOpen = false;
      this.selectedId = "";
      this.detail = null;
      this.receipts = null;
      this.detailError = "";
    },
  },
};
</script>
