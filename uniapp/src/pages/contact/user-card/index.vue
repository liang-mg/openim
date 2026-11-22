<template>
  <view class="app-page">
    <page-header title="用户资料" />

    <view v-if="loading" class="px-3 pt-4"><view class="oa-card"><skeleton :lines="4" :height="16" /></view></view>
    <empty-state v-else-if="error" :text="error" name="user" />

    <view v-else class="px-3 pt-4 pb-7">
      <view class="oa-card uc-card">
        <oim-avatar :text="(displayName || '?').slice(0, 1)" :size="64" />
        <view class="uc-main">
          <view class="flex items-center gap-2">
            <text class="uc-name">{{ displayName }}</text>
            <text v-if="isSelf" class="uc-tag">自己</text>
            <text v-else-if="isFriend" class="uc-tag uc-tag--ok">好友</text>
          </view>
          <text class="uc-id">用户ID：{{ userID }}</text>
          <text v-if="user.phoneNumber && isFriend" class="uc-id">手机号：{{ user.phoneNumber }}</text>
          <text v-if="isFriend && remark" class="uc-id">备注：{{ remark }}</text>
        </view>
      </view>

      <view v-if="isFriend" class="oa-card mt-3">
        <view v-if="!editingRemark" class="uc-row" @tap="startEditRemark">
          <text class="uc-row-label">修改备注</text>
          <text class="uc-row-value">{{ remark || "未设置" }}</text>
          <text class="uc-arrow">›</text>
        </view>
        <view v-else class="uc-edit">
          <input v-model="remarkDraft" class="uc-input" placeholder="输入备注名" maxlength="24" />
          <view class="uc-edit-actions">
            <view class="uc-btn uc-btn--ghost" @tap="editingRemark = false">取消</view>
            <view class="uc-btn uc-btn--primary" @tap="saveRemark">{{ saving ? "保存中" : "保存" }}</view>
          </view>
        </view>
      </view>

      <view class="uc-actions">
        <view v-if="isFriend" class="uc-primary" @tap="openChat"><text class="uc-primary-text">发消息</text></view>
        <view v-else-if="!isSelf" class="uc-primary" @tap="goAddFriend"><text class="uc-primary-text">添加好友</text></view>
        <view v-if="isFriend" class="uc-danger" @tap="removeFriend"><text class="uc-danger-text">删除好友</text></view>
      </view>

      <view v-if="!isFriend && !isSelf" class="uc-tip">对方通过好友申请后，才能直接发消息。</view>
    </view>
  </view>
</template>

<script>
import PageHeader from "@/components/page-header.vue";
import OimAvatar from "@/components/oim-avatar.vue";
import EmptyState from "@/components/empty-state.vue";
import Skeleton from "@/components/skeleton.vue";
import { getUsersInfo, listFriends, updateFriendRemark, deleteFriend, getOrCreateConversation, connect } from "@/api/im";
import { getUserId } from "@/utils/storage";

/**
 * 用户资料卡：发消息 / 添加好友 / 修改备注 / 删除好友。
 * 从通讯录长按、聊天页标题、搜索结果都可以进来。
 */
export default {
  components: { PageHeader, OimAvatar, EmptyState, Skeleton },
  data() {
    return {
      userID: "",
      fallbackName: "",
      user: {},
      friend: null,
      loading: true,
      error: "",
      editingRemark: false,
      remarkDraft: "",
      saving: false,
      selfID: "",
    };
  },
  computed: {
    isSelf() {
      return this.userID && this.userID === this.selfID;
    },
    isFriend() {
      return Boolean(this.friend);
    },
    displayName() {
      return (this.friend && (this.friend.remark || this.friend.nickname)) || this.user.nickname || this.fallbackName || this.userID;
    },
    remark() {
      return (this.friend && this.friend.remark) || "";
    },
  },
  onLoad(options) {
    this.userID = decodeURIComponent(options.userID || "");
    this.fallbackName = decodeURIComponent(options.name || "");
    this.selfID = getUserId();
    this.load();
  },
  methods: {
    async load() {
      if (!this.userID) {
        this.error = "缺少用户ID";
        this.loading = false;
        return;
      }
      this.loading = true;
      this.error = "";
      try {
        await connect();
        const [users, friends] = await Promise.all([
          getUsersInfo([this.userID]).catch(() => []),
          listFriends().catch(() => []),
        ]);
        this.user = users.find((u) => u.userID === this.userID) || { userID: this.userID, nickname: this.fallbackName };
        this.friend = friends.find((f) => f.userID === this.userID) || null;
        this.remarkDraft = (this.friend && this.friend.remark) || "";
      } catch (e) {
        this.error = e.message || "用户资料加载失败";
      } finally {
        this.loading = false;
      }
    },
    startEditRemark() {
      this.remarkDraft = this.remark;
      this.editingRemark = true;
    },
    async saveRemark() {
      if (this.saving) return;
      this.saving = true;
      try {
        await updateFriendRemark({ userID: this.userID, remark: String(this.remarkDraft || "").trim() });
        this.friend = { ...this.friend, remark: String(this.remarkDraft || "").trim() };
        this.editingRemark = false;
        uni.showToast({ title: "备注已更新", icon: "none" });
      } catch (e) {
        uni.showToast({ title: e.message || "保存失败", icon: "none" });
      } finally {
        this.saving = false;
      }
    },
    async openChat() {
      try {
        const conv = await getOrCreateConversation({ sourceID: this.userID, sessionType: 1 });
        if (!conv || !conv.conversationID) throw new Error("会话创建失败");
        uni.navigateTo({
          url: `/pages/chat/index?conversationID=${encodeURIComponent(conv.conversationID)}&name=${encodeURIComponent(this.displayName)}&group=0`,
        });
      } catch (e) {
        uni.showToast({ title: e.message || "打开会话失败", icon: "none" });
      }
    },
    goAddFriend() {
      uni.navigateTo({ url: `/pages/contact/add-friend/index?keyword=${encodeURIComponent(this.userID)}` });
    },
    removeFriend() {
      uni.showModal({
        title: "删除好友",
        content: `确定删除「${this.displayName}」吗？聊天记录不会删除。`,
        success: async (res) => {
          if (!res.confirm) return;
          try {
            await deleteFriend(this.userID);
            this.friend = null;
            uni.showToast({ title: "已删除", icon: "none" });
            setTimeout(() => uni.navigateBack(), 500);
          } catch (e) {
            uni.showToast({ title: e.message || "删除失败", icon: "none" });
          }
        },
      });
    },
  },
};
</script>

<style scoped>
.uc-card {
  display: flex;
  align-items: center;
  gap: 14px;
}

.uc-main {
  flex: 1;
  min-width: 0;
}

.uc-name {
  font-size: 18px;
  color: var(--ink);
  font-weight: 600;
}

.uc-tag {
  font-size: 9px;
  color: var(--ink-3);
  background: var(--fill-2);
  border-radius: 4px;
  padding: 1px 5px;
}

.uc-tag--ok {
  color: var(--ok-text);
  background: var(--ok-soft);
}

.uc-id {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--ink-3);
}

.uc-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.uc-row-label {
  font-size: 14px;
  color: var(--ink);
}

.uc-row-value {
  flex: 1;
  text-align: right;
  font-size: 13px;
  color: var(--ink-3);
}

.uc-arrow {
  font-size: 20px;
  color: var(--ink-4);
}

.uc-edit {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.uc-input {
  height: 36px;
  padding: 0 10px;
  border-radius: 8px;
  background: var(--fill-2);
  font-size: 14px;
}

.uc-edit-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.uc-btn {
  height: 30px;
  min-width: 62px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}

.uc-btn--ghost {
  background: var(--fill-2);
  color: var(--ink-2);
}

.uc-btn--primary {
  background: var(--brand);
  color: #fff;
}

.uc-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 20px;
}

.uc-primary {
  height: 44px;
  border-radius: 10px;
  background: var(--brand);
  display: flex;
  align-items: center;
  justify-content: center;
}

.uc-primary-text {
  color: #fff;
  font-size: 15px;
  font-weight: 500;
}

.uc-danger {
  height: 44px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid #ffccc7;
  display: flex;
  align-items: center;
  justify-content: center;
}

.uc-danger-text {
  color: var(--danger);
  font-size: 15px;
}

.uc-tip {
  margin-top: 14px;
  font-size: 11px;
  color: var(--ink-4);
  line-height: 1.6;
}
</style>
