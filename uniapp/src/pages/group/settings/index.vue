<template>
  <view class="app-page">
    <page-header title="群设置" />

    <view v-if="loading" class="px-3 pt-4"><view class="oa-card"><skeleton :lines="5" :height="16" /></view></view>
    <empty-state v-else-if="error" :text="error" name="users" />

    <view v-else class="px-3 pt-3 pb-8">
      <view class="oa-card gs-head">
        <view class="gs-icon">群</view>
        <view class="gs-main">
          <text class="gs-name">{{ group.groupName || groupID }}</text>
          <text class="gs-sub">群ID：{{ groupID }}</text>
          <text class="gs-sub">{{ group.memberCount || members.length }} 人</text>
        </view>
      </view>

      <view v-if="group.notification" class="oa-card mt-3">
        <text class="gs-label">群公告</text>
        <text class="gs-notice">{{ group.notification }}</text>
      </view>

      <view class="oa-card mt-3 gs-actions">
        <view class="gs-row" @tap="openChat"><text class="gs-row-label">进入群聊</text><text class="gs-arrow">›</text></view>
        <view class="gs-row" @tap="goInvite"><text class="gs-row-label">邀请好友</text><text class="gs-arrow">›</text></view>
        <view v-if="canManage" class="gs-row" @tap="startEdit('name')"><text class="gs-row-label">修改群名</text><text class="gs-arrow">›</text></view>
        <view v-if="canManage" class="gs-row" @tap="startEdit('notice')"><text class="gs-row-label">修改群公告</text><text class="gs-arrow">›</text></view>
        <view v-if="isOwner" class="gs-row" @tap="transferHint"><text class="gs-row-label">转让群主</text><text class="gs-arrow">›</text></view>
      </view>

      <view v-if="editing" class="oa-card mt-3">
        <text class="gs-label">{{ editing === "name" ? "群名称" : "群公告" }}</text>
        <input v-if="editing === 'name'" v-model="editDraft" class="gs-input" maxlength="24" placeholder="输入群名称" />
        <textarea v-else v-model="editDraft" class="gs-textarea" maxlength="300" placeholder="输入群公告" />
        <view class="gs-edit-actions">
          <view class="gs-btn gs-btn--ghost" @tap="editing = ''">取消</view>
          <view class="gs-btn gs-btn--primary" @tap="saveEdit">{{ saving ? "保存中" : "保存" }}</view>
        </view>
      </view>

      <view class="gs-section-title">群成员（{{ members.length }}）</view>
      <view class="oa-card gs-members">
        <view v-for="m in members" :key="m.userID" class="gs-member" @tap="memberAction(m)">
          <oim-avatar :text="(m.nickname || '?').slice(0, 1)" :size="38" />
          <view class="gs-member-main">
            <view class="flex items-center gap-2">
              <text class="gs-member-name">{{ m.nickname || m.userID }}</text>
              <text v-if="m.userID === group.ownerUserID || (!group.ownerUserID && m.roleLevel === 100)" class="gs-tag gs-tag--owner">群主</text>
              <text v-else-if="m.roleLevel === 60" class="gs-tag">管理员</text>
              <text v-if="m.userID === selfID" class="gs-tag">我</text>
            </view>
            <text class="gs-member-id">用户ID：{{ m.userID }}</text>
          </view>
          <text v-if="canManage && m.userID !== selfID" class="gs-arrow">›</text>
        </view>
      </view>

      <view class="gs-danger-zone">
        <view v-if="isOwner" class="gs-danger" @tap="dismiss"><text class="gs-danger-text">解散群聊</text></view>
        <view v-else class="gs-danger" @tap="quit"><text class="gs-danger-text">退出群聊</text></view>
      </view>
    </view>
  </view>
</template>

<script>
import PageHeader from "@/components/page-header.vue";
import OimAvatar from "@/components/oim-avatar.vue";
import EmptyState from "@/components/empty-state.vue";
import Skeleton from "@/components/skeleton.vue";
import {
  connect,
  getGroupInfo,
  getGroupMembers,
  setGroupInfo,
  kickGroupMember,
  transferGroupOwner,
  quitGroup,
  dismissGroup,
  getOrCreateConversation,
} from "@/api/im";
import { getUserId } from "@/utils/storage";

/**
 * 群设置：群资料、成员、邀请、改名/公告、踢人、转让、退群/解散。
 * 权限：群主可改名/公告/踢人/转让/解散；管理员可改名/公告/踢人；普通成员只能邀请/退群。
 */
export default {
  components: { PageHeader, OimAvatar, EmptyState, Skeleton },
  data() {
    return {
      groupID: "",
      group: {},
      members: [],
      selfID: "",
      loading: true,
      error: "",
      editing: "",
      editDraft: "",
      saving: false,
      busy: false,
    };
  },
  computed: {
    selfMember() {
      return this.members.find((m) => m.userID === this.selfID) || null;
    },
    isOwner() {
      if (this.group.ownerUserID) return this.group.ownerUserID === this.selfID;
      return Number((this.selfMember && this.selfMember.roleLevel) || 0) === 100;
    },
    isAdmin() {
      return this.isOwner || Number((this.selfMember && this.selfMember.roleLevel) || 0) >= 60;
    },
    canManage() {
      return this.isAdmin;
    },
  },
  onLoad(options) {
    this.groupID = decodeURIComponent(options.groupID || "");
    this.selfID = getUserId();
  },
  onShow() {
    this.load();
  },
  methods: {
    async load() {
      if (!this.groupID) {
        this.error = "缺少群ID";
        this.loading = false;
        return;
      }
      this.loading = true;
      this.error = "";
      try {
        await connect();
        const [group, members] = await Promise.all([
          getGroupInfo(this.groupID),
          getGroupMembers(this.groupID, { count: 200 }),
        ]);
        if (!group) throw new Error("群不存在或你不在群里");
        this.group = group;
        this.members = members;
      } catch (e) {
        this.error = e.message || "群资料加载失败";
      } finally {
        this.loading = false;
      }
    },
    async openChat() {
      try {
        const conv = await getOrCreateConversation({ sourceID: this.groupID, sessionType: 3 });
        if (!conv || !conv.conversationID) throw new Error("群会话创建失败");
        uni.navigateTo({
          url: `/pages/chat/index?conversationID=${encodeURIComponent(conv.conversationID)}&name=${encodeURIComponent(this.group.groupName || this.groupID)}&group=1&members=${this.group.memberCount || this.members.length}`,
        });
      } catch (e) {
        uni.showToast({ title: e.message || "打开群聊失败", icon: "none" });
      }
    },
    goInvite() {
      uni.navigateTo({ url: `/pages/group/invite/index?groupID=${encodeURIComponent(this.groupID)}` });
    },
    startEdit(kind) {
      this.editing = kind;
      this.editDraft = kind === "name" ? this.group.groupName || "" : this.group.notification || "";
    },
    async saveEdit() {
      if (this.saving) return;
      const value = String(this.editDraft || "").trim();
      if (this.editing === "name" && !value) {
        uni.showToast({ title: "群名称不能为空", icon: "none" });
        return;
      }
      this.saving = true;
      try {
        const params = { groupID: this.groupID };
        if (this.editing === "name") params.groupName = value;
        else params.notification = value;
        await setGroupInfo(params);
        if (this.editing === "name") this.group = { ...this.group, groupName: value };
        else this.group = { ...this.group, notification: value };
        this.editing = "";
        uni.showToast({ title: "已保存", icon: "none" });
      } catch (e) {
        uni.showToast({ title: e.message || "保存失败", icon: "none" });
      } finally {
        this.saving = false;
      }
    },
    memberAction(m) {
      if (!m || m.userID === this.selfID || !this.canManage) return;
      const actions = [];
      if (this.isOwner) actions.push("转让群主");
      actions.push("移出群聊");
      uni.showActionSheet({
        itemList: actions,
        success: (res) => {
          if (actions[res.tapIndex] === "转让群主") this.transfer(m);
          else this.kick(m);
        },
      });
    },
    transferHint() {
      uni.showToast({ title: "点击成员，选择「转让群主」", icon: "none" });
    },
    transfer(m) {
      uni.showModal({
        title: "转让群主",
        content: `确定把群主转让给「${m.nickname || m.userID}」吗？转让后你将变为普通成员。`,
        success: async (res) => {
          if (!res.confirm) return;
          try {
            await transferGroupOwner({ groupID: this.groupID, userID: m.userID });
            uni.showToast({ title: "已转让", icon: "none" });
            this.load();
          } catch (e) {
            uni.showToast({ title: e.message || "转让失败", icon: "none" });
          }
        },
      });
    },
    kick(m) {
      uni.showModal({
        title: "移出群聊",
        content: `确定把「${m.nickname || m.userID}」移出群聊吗？`,
        success: async (res) => {
          if (!res.confirm) return;
          try {
            await kickGroupMember({ groupID: this.groupID, userID: m.userID });
            uni.showToast({ title: "已移出", icon: "none" });
            this.load();
          } catch (e) {
            uni.showToast({ title: e.message || "操作失败", icon: "none" });
          }
        },
      });
    },
    quit() {
      uni.showModal({
        title: "退出群聊",
        content: "退出后将不再收到该群消息，确定退出吗？",
        success: async (res) => {
          if (!res.confirm) return;
          try {
            await quitGroup(this.groupID);
            uni.showToast({ title: "已退出", icon: "none" });
            setTimeout(() => uni.switchTab({ url: "/pages/message/index" }), 400);
          } catch (e) {
            uni.showToast({ title: e.message || "退出失败", icon: "none" });
          }
        },
      });
    },
    dismiss() {
      uni.showModal({
        title: "解散群聊",
        content: "解散后所有成员都会被移出，聊天记录不可恢复，确定解散吗？",
        success: async (res) => {
          if (!res.confirm) return;
          try {
            await dismissGroup(this.groupID);
            uni.showToast({ title: "已解散", icon: "none" });
            setTimeout(() => uni.switchTab({ url: "/pages/message/index" }), 400);
          } catch (e) {
            uni.showToast({ title: e.message || "解散失败", icon: "none" });
          }
        },
      });
    },
  },
};
</script>

<style scoped>
.gs-head {
  display: flex;
  align-items: center;
  gap: 14px;
}

.gs-icon {
  width: 54px;
  height: 54px;
  border-radius: 14px;
  background: var(--ok-soft);
  color: var(--ok-text);
  font-size: 20px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.gs-main {
  flex: 1;
  min-width: 0;
}

.gs-name {
  display: block;
  font-size: 18px;
  color: var(--ink);
  font-weight: 600;
}

.gs-sub {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  color: var(--ink-3);
}

.gs-label {
  display: block;
  font-size: 12px;
  color: var(--ink-3);
  margin-bottom: 4px;
}

.gs-notice {
  font-size: 13px;
  color: var(--ink-2);
  line-height: 1.6;
}

.gs-actions {
  padding: 0;
  overflow: hidden;
}

.gs-row {
  display: flex;
  align-items: center;
  padding: 13px 14px;
  border-bottom: 1px solid var(--line);
}

.gs-row:last-child {
  border-bottom: none;
}

.gs-row-label {
  flex: 1;
  font-size: 14px;
  color: var(--ink);
}

.gs-arrow {
  font-size: 20px;
  color: var(--ink-4);
}

.gs-input,
.gs-textarea {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--fill-2);
  font-size: 13px;
  box-sizing: border-box;
}

.gs-input {
  height: 38px;
}

.gs-textarea {
  min-height: 80px;
}

.gs-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

.gs-btn {
  height: 30px;
  min-width: 62px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}

.gs-btn--ghost {
  background: var(--fill-2);
  color: var(--ink-2);
}

.gs-btn--primary {
  background: var(--brand);
  color: var(--on-primary);
}

.gs-section-title {
  margin: 16px 2px 8px;
  font-size: 12px;
  color: var(--ink-3);
}

.gs-members {
  padding: 0;
  overflow: hidden;
}

.gs-member {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
}

.gs-member:last-child {
  border-bottom: none;
}

.gs-member-main {
  flex: 1;
  min-width: 0;
}

.gs-member-name {
  font-size: 14px;
  color: var(--ink);
  font-weight: 500;
}

.gs-member-id {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  color: var(--ink-4);
}

.gs-tag {
  font-size: 9px;
  color: var(--ink-3);
  background: var(--fill-2);
  border-radius: 4px;
  padding: 1px 5px;
}

.gs-tag--owner {
  color: var(--warn-text);
  background: var(--warn-soft);
}

.gs-danger-zone {
  margin-top: 18px;
}

.gs-danger {
  height: 44px;
  border-radius: 10px;
  background: var(--card);
  border: 1px solid var(--danger-line);
  display: flex;
  align-items: center;
  justify-content: center;
}

.gs-danger-text {
  font-size: 15px;
  color: var(--danger);
}
</style>
