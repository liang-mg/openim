<template>
  <view v-if="items.length" class="mt-2 pt-2 border-t border-line flex flex-col gap-1">
    <view
      v-for="a in items"
      :key="a.file_id"
      class="flex items-center gap-1.5 min-w-0 py-0.5"
      @tap="download(a)"
    >
      <app-icon name="paperclip" :size="13" tone="ink-3" />
      <text class="flex-1 min-w-0 text-xs text-brand overflow-hidden whitespace-nowrap" style="text-overflow: ellipsis">{{ nameOf(a) }}</text>
      <text v-if="sizeOf(a)" class="text-2xs text-ink-4">{{ sizeOf(a) }}</text>
      <text class="text-2xs text-brand pl-0.5">{{ downloadingId === a.file_id ? "下载中" : "下载" }}</text>
    </view>
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";
import { downloadLeaveAttachment, formatFileSize } from "@/api/oa";

/**
 * 请假申请卡片底部的附件行。
 *
 * 数据来自 getLeaveList 的 record.attachments（后端 model.LeaveAttachment：{ file_id, name }），
 * 与 PC 端 frontend/src/pages/leave/index.tsx 的附件列同源。
 * 下载走 OA 接口层的 downloadLeaveAttachment(leave_id, file_id)：它已用 uni.downloadFile
 * 带 token 取文件并返回本地临时路径，页面无需再处理鉴权头。
 *   移动端差异：H5 用 <a download> 触发浏览器保存；App 用 uni.openDocument 调系统查看器。
 */
export default {
  name: "AttachmentLinks",
  components: { AppIcon },
  props: {
    leaveId: { type: String, default: "" },
    items: { type: Array, default: () => [] },
  },
  data() {
    return { downloadingId: "" };
  },
  methods: {
    nameOf(a) {
      return a.name || "附件";
    },
    sizeOf(a) {
      // 后端 LeaveAttachment 目前只回 file_id/name；将来带上 size 时按统一口径展示
      return a.size ? formatFileSize(a.size) : "";
    },
    toast(title) {
      uni.showToast({ title, icon: "none" });
    },
    async download(a) {
      const fileId = (a && a.file_id) || "";
      if (!fileId || !this.leaveId) {
        this.toast("附件地址无效");
        return;
      }
      if (this.downloadingId) return; // 连点只发一次请求
      this.downloadingId = fileId;
      try {
        const filePath = await downloadLeaveAttachment(this.leaveId, fileId);
        // #ifdef H5
        const link = document.createElement("a");
        link.href = filePath;
        link.download = this.nameOf(a);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        // #endif
        // #ifndef H5
        uni.openDocument({
          filePath,
          showMenu: true,
          fail: () => this.toast("暂不支持打开该附件，请稍后重试"),
        });
        // #endif
      } catch (e) {
        this.toast(e.message || "附件下载失败，请稍后重试");
      } finally {
        this.downloadingId = "";
      }
    },
  },
};
</script>
