/**
 * 用户搜索（OpenIM chat API，和 PC 的 searchBusinessUserInfo 同一接口）。
 * 只用于“添加好友”按手机号/昵称/账号搜索。
 */
import { chatPost } from "@/utils/request";

export async function searchUsers(keyword) {
  const body = await chatPost("/user/search/full", {
    keyword: String(keyword || "").trim(),
    pagination: { pageNumber: 1, showNumber: 10 },
  });
  // chat API 返回 { errCode, data: { total, users } }，不是 OA 的 { code, data } 信封
  const data = (body && body.data) || body || {};
  const users = data.users || (body && body.users) || [];
  return users.map((u) => ({
    userID: u.userID || "",
    nickname: u.nickname || u.userID || "",
    faceURL: u.faceURL || "",
    phoneNumber: u.phoneNumber || "",
    account: u.account || "",
    allowAddFriend: Number(u.allowAddFriend || 0),
    raw: u,
  }));
}

export default { searchUsers };
