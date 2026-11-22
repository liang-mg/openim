<template>
  <view class="app-page">
    <page-header title="加入群组" />

    <view class="px-3 pt-3 pb-7">
      <view class="ag-search oa-card">
        <input v-model="groupID" class="ag-input" placeholder="输入群ID" placeholder-class="ag-ph" confirm-type="search" @confirm="search" />
        <view class="ag-search-btn" @tap="search"><text class="ag-search-text">{{ searching ? "查找中" : "查找" }}</text></view>
      </view>

      <empty-state v-if="searched && !group && !searching" text="没有找到这个群，确认群ID是否正确" name="users" />

      <view v-if="group" class="oa-card mt-3">
        <view class="flex items-center gap-3">
          <view class="ag-icon">群</view>
          <view class="flex-1 min-w-0">
            <text class="ag-name">{{ group.groupName || group.groupID }}</text>
            <text class="ag-sub">群ID：{{ group.groupID }}</text>
            <text class="ag-sub">{{ group.memberCount || 0 }} 人</text>
          </view>
          <text v-if="joined" class="ag-tag">已在群内</text>
        </view>

        <template v-if="joined">
          <view class="ag-primary mt-4" @tap="openChat"><text class="ag-primary-text">进入群聊</text></view>
        </template>
        <template v-else>
          <text class="ag-label">申请消息</text>
          <textarea v-model="reqMsg" class="ag-textarea" maxlength="80" placeholder="你好，我想加入这个群" placeholder-class="ag-ph" />
          <view class="ag-primary mt-3" @tap="join"><text class="ag-primary-text">{{ joining ? "提交中…" : "申请加入" }}</text></view>
        </template>
      </view>

      <view class="ag-tip">群主/管理员开启“需要验证”时，申请会发到群通知；关闭验证时会直接入群。</view>
    </view>
  </view>
</template>

<script>
import PageHeader from "@/components/page-header.vue";
import EmptyState from "@/components/empty-state.vue";
import { getGroupInfo, joinGroup, listGroups, getOrCreateConversation, connect } from "@/api/im";

/** 按群ID搜索并申请加入群组。 */
export default {
  components: { PageHeader, EmptyState },
  data() {
    return {
      groupID: "",
      group: null,
      joined: false,
      searched: false,
      searching: false,
      joining: false,
      reqMsg: "你好，我想加入这个群",
    };
  },
  onLoad(options) {
    if (options.groupID) {
      this.groupID = decodeURIComponent(options.groupID);
      this.search();
    }
  },
  methods: {
    async search() {
      const id = String(this.groupID || "").trim();
      if (!id) {
        uni.showToast({ title: "请输入群ID", icon: "none" });
        return;
      }
      if (this.searching) return;
      this.searching = true;
      this.searched = false;
      this.group = null;
      this.joined = false;
      try {
        await connect();
        const [info, groups] = await Promise.all([
          getGroupInfo(id).catch(() => null),
          listGroups().catch(() => []),
        ]);
        this.group = info;
        this.joined = groups.some((g) => g.groupID === id);
        this.searched = true;
      } catch (e) {
        uni.showToast({ title: e.message || "查找失败", icon: "none" });
      } finally {
        this.searching = false;
      }
    },
    async join() {
      if (!this.group || this.joining) return;
      this.joining = true;
      try {
        await joinGroup({ groupID: this.group.groupID, reqMsg: String(this.reqMsg || "").trim() || "申请加入" });
        uni.showToast({ title: "申请已提交", icon: "none" });
        // 如果群不需要验证，可能已经直接入群
        const groups = await listGroups().catch(() => []);
        this.joined = groups.some((g) => g.groupID === this.group.groupID);
        if (this.joined) this.openChat();
      } catch (e) {
        uni.showToast({ title: e.message || "申请失败", icon: "none" });
      } finally {
        this.joining = false;
      }
    },
    async openChat() {
      if (!this.group) return;
      try {
        const conv = await getOrCreateConversation({ sourceID: this.group.groupID, sessionType: 3 });
        if (!conv || !conv.conversationID) throw new Error("会话创建失败");
        uni.navigateTo({
          url: `/pages/chat/index?conversationID=${encodeURIComponent(conv.conversationID)}&name=${encodeURIComponent(this.group.groupName || this.group.groupID)}&group=1&members=${this.group.memberCount || 0}`,
        });
      } catch (e) {
        uni.showToast({ title: e.message || "打开群聊失败", icon: "none" });
      }
    },
  },
};
</script>

<style scoped>
.ag-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
}

.ag-input {
  flex: 1;
  height: 36px;
  padding: 0 10px;
  border-radius: 8px;
  background: var(--fill-2);
  font-size: 14px;
}

.ag-ph {
  color: var(--ink-4);
}

.ag-search-btn {
  height: 36px;
  padding: 0 16px;
  border-radius: 8px;
  background: var(--brand);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ag-search-text {
  color: var(--on-primary);
  font-size: 13px;
}

.ag-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: var(--ok-soft);
  color: var(--ok-text);
  font-size: 18px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ag-name {
  display: block;
  font-size: 16px;
  color: var(--ink);
  font-weight: 600;
}

.ag-sub {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  color: var(--ink-3);
}

.ag-tag {
  font-size: 9px;
  color: var(--ok-text);
  background: var(--ok-soft);
  border-radius: 4px;
  padding: 1px 5px;
}

.ag-label {
  display: block;
  margin-top: 16px;
  font-size: 12px;
  color: var(--ink-3);
}

.ag-textarea {
  width: 100%;
  min-height: 64px;
  margin-top: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--fill-2);
  font-size: 13px;
  box-sizing: border-box;
}

.ag-primary {
  height: 42px;
  border-radius: 9px;
  background: var(--brand);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ag-primary-text {
  color: var(--on-primary);
  font-size: 14px;
  font-weight: 500;
}

.ag-tip {
  margin-top: 14px;
  font-size: 11px;
  color: var(--ink-4);
  line-height: 1.6;
}
</style>
