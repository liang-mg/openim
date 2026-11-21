/**
 * 用户 / 权限 store。
 *
 * 权限口径与 PC 端一致：全部由后端 /me 返回，前端只做展示层的显隐，
 * 真正的越权判断在 backend（visibleUserIDs / 403），前端不信任何 id。
 */
import { defineStore } from "pinia";
import { getMe } from "@/api/oa";
import { getProfileCache, setProfileCache, clearAuth } from "@/utils/storage";

const EMPTY = {
  user_id: "",
  real_name: "",
  department: "",
  position: "",
  manager_id: "",
  role: "employee",
  is_admin: false,
  disabled: false,
};

export const useUserStore = defineStore("user", {
  state: () => ({
    profile: getProfileCache() || { ...EMPTY },
    loaded: false,
  }),

  getters: {
    /** 头像文字兜底：姓名首字 */
    avatarText: (state) => (state.profile.real_name || "同").slice(0, 1),
    displayName: (state) => state.profile.real_name || "未设置姓名",
    department: (state) => state.profile.department || "未分配部门",
    position: (state) => state.profile.position || "",
    isAdmin: (state) => Boolean(state.profile.is_admin),
    /** 能审批的人（组长/领导/HR） */
    canApprove: (state) => ["manager", "leader", "hr", "admin"].includes(state.profile.role),
    /** 能看团队数据的人 */
    canViewTeam: (state) => ["manager", "leader", "hr", "admin"].includes(state.profile.role),
    roleText: (state) => {
      const map = {
        employee: "员工",
        manager: "组长",
        leader: "领导",
        hr: "HR",
        admin: "管理员",
      };
      return map[state.profile.role] || "员工";
    },
  },

  actions: {
    /** 拉取 /me；失败时不清登录态，交给 request 层处理 401 */
    async fetchProfile(force = false) {
      if (this.loaded && !force) return this.profile;
      const data = await getMe();
      this.profile = { ...EMPTY, ...data };
      this.loaded = true;
      setProfileCache(this.profile);
      return this.profile;
    },

    logout() {
      clearAuth();
      this.profile = { ...EMPTY };
      this.loaded = false;
    },
  },
});

export default useUserStore;
