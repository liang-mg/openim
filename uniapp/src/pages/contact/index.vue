<template>
  <view class="app-page ct">
    <view class="app-topbar">
      <text class="app-topbar__title">通讯录</text>
      <text class="ct__count">{{ tab === "friends" ? `${filteredFriends.length} 位好友` : `${filteredGroups.length} 个群` }}</text>
    </view>

    <view class="ct__tabs">
      <view class="ct__tab" :class="{ 'ct__tab--active': tab === 'friends' }" @tap="tab = 'friends'">
        <text class="ct__tab-text">好友</text>
      </view>
      <view class="ct__tab" :class="{ 'ct__tab--active': tab === 'groups' }" @tap="tab = 'groups'">
        <text class="ct__tab-text">群聊</text>
      </view>
    </view>

    <view class="ct__search">
      <input v-model="keyword" class="ct__search-input" :placeholder="tab === 'friends' ? '搜索好友' : '搜索群聊'" placeholder-class="ct__ph" />
    </view>

    <view class="ct__list">
      <view v-if="!current.length" class="empty"><text>{{ keyword ? "没有匹配的结果" : "暂无数据" }}</text></view>

      <person-row v-for="item in current" :key="item.id" :item="item" @open="openChat" />

      <view v-if="isMock" class="ct__tip">
        <text class="ct__tip-text">好友/群组来自本地假数据（VITE_IM_MODE=mock）。真实数据由 OpenIM 好友关系与群组接口提供，接入后本页不用改。</text>
      </view>
      <view class="page-bottom-space" />
    </view>

    <app-tabbar active="contact" />
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";
import OimAvatar from "@/components/oim-avatar.vue";
import AppTabbar from "@/components/app-tabbar.vue";
import PersonRow from "./components/person-row.vue";
import { listFriends, listGroups, isMock, connect, getState } from "@/api/im";
import { getToken } from "@/utils/storage";
import { peek, put } from "@/utils/swr";
import { useUserStore } from "@/store/user";

/**
 * 通讯录。对应 PC 端 frontend/src/pages/contact/：
 *   好友 / 群聊 两个列表（PC 还有「新的朋友」「群通知」，需要 IM 好友申请接口，先在待办里）。
 * 点人直接进会话：mock 下是一个新会话（空消息），真实 SDK 下是建会话再进。
 */
export default {
  components: { AppIcon, OimAvatar, AppTabbar, PersonRow },
  data() {
    return {
      tab: "friends",
      keyword: "",
      friends: [],
      groups: [],
      isMock: isMock(),
    };
  },
  computed: {
    filteredFriends() {
      const k = this.keyword.trim();
      const list = this.friends.map((f) => ({
        id: f.userID,
        name: f.nickname,
        sub: [f.department, f.position].filter(Boolean).join(" · ") || "未设置部门",
        online: f.online,
        group: false,
      }));
      return k ? list.filter((f) => f.name.includes(k) || f.sub.includes(k)) : list;
    },
    filteredGroups() {
      const k = this.keyword.trim();
      const list = this.groups.map((g) => ({
        id: g.groupID,
        name: g.name,
        sub: `${g.memberCount} 人`,
        online: false,
        group: true,
      }));
      return k ? list.filter((g) => g.name.includes(k)) : list;
    },
    current() {
      return this.tab === "friends" ? this.filteredFriends : this.filteredGroups;
    },
  },
  onShow() {
    if (!getToken()) {
      uni.reLaunch({ url: "/pages/login/index" });
      return;
    }
    useUserStore()
      .fetchProfile()
      .catch(() => {});
    this.load();
  },
  methods: {
    async load() {
      // 先铺缓存：切回通讯录 tab 不该看到空白
      const cached = peek("im:contacts");
      if (cached) {
        this.friends = cached.friends || [];
        this.groups = cached.groups || [];
      }
      const connecting =
        getState() === "connected"
          ? Promise.resolve()
          : connect().catch(() => {
              /* 连接失败也把本地数据展示出来，顶部已有状态提示 */
            });
      // mock 数据不依赖连接，先出列表；真实 SDK 必须先连上
      if (!isMock()) await connecting;
      try {
        const [friends, groups] = await Promise.all([listFriends(), listGroups()]);
        this.friends = friends;
        this.groups = groups;
        put("im:contacts", { friends, groups });
      } catch (e) {
        if (!peek("im:contacts")) {
          this.friends = [];
          this.groups = [];
        }
        uni.showToast({ title: e.message || "通讯录加载失败", icon: "none" });
      }
      await connecting;
    },
    openChat(item) {
      const conversationID = item.group ? item.id : `single_${item.id}`;
      uni.navigateTo({
        url: `/pages/chat/index?conversationID=${encodeURIComponent(conversationID)}&name=${encodeURIComponent(item.name)}&group=${item.group ? 1 : 0}`,
      });
    },
  },
};
</script>

<style scoped>
.ct__count {
  font-size: 11px;
  opacity: 0.9;
}

.ct__tabs {
  display: flex;
  background: #fff;
  border-bottom: 1px solid var(--line);
}

.ct__tab {
  flex: 1;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.ct__tab-text {
  font-size: 14px;
  color: var(--ink-2);
}

.ct__tab--active .ct__tab-text {
  color: var(--brand);
  font-weight: 600;
}

.ct__tab--active::after {
  content: "";
  position: absolute;
  bottom: 0;
  width: 40px;
  height: 2px;
  background: var(--brand);
  border-radius: 1px;
}

.ct__search {
  padding: 8px 12px;
  background: #fff;
}

.ct__search-input {
  height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  background: var(--fill-2);
  font-size: 13px;
}

.ct__ph {
  color: var(--ink-4);
}

.ct__list {
  background: #fff;
}

.person {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
}

.person:active {
  background: var(--fill);
}

.person__main {
  flex: 1;
  min-width: 0;
}

.person__head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.person__name {
  font-size: 15px;
  color: var(--ink);
  font-weight: 500;
}

.person__online {
  font-size: 9px;
  color: var(--ok-text);
  background: var(--ok-soft);
  border-radius: 4px;
  padding: 1px 5px;
}

.person__sub {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  color: var(--ink-3);
}

.person__arrow {
  font-size: 18px;
  color: var(--ink-4);
}

.ct__tip {
  padding: 16px 16px 4px;
}

.ct__tip-text {
  font-size: 10px;
  color: var(--ink-4);
  text-align: center;
  display: block;
  line-height: 1.6;
}
</style>
