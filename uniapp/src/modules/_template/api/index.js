/**
 * 模块接口层：只做「参数整理 + 调 api/oa.js」，不自己拼 URL、不自己发请求。
 *
 * 约定：这里的每个函数都必须能对应 `src/api/oa.js` 里的同名实现，
 * 而 `api/oa.js` 又与 `frontend/src/api/oaApi.ts` 同名同参 ——
 * 三层对齐由 `npm run guard:contract` 守住（缺函数/自造路径直接失败）。
 *
 * 模板里的 `oaListXxx` 是占位名，接入时换成 PC 端真实函数。
 */
import { getWorkbenchSummary } from "@/api/oa";

/** 列表：入参只用后端认识的键名（分页 page/page_size、筛选 keyword/status） */
export async function listRecords({ page = 1, pageSize = 20, keyword = "", status = "" } = {}) {
  // TODO 换成真实列表接口，例如：
  // return getSomethingList({ page, page_size: pageSize, keyword: keyword || undefined, status: status || undefined });
  //
  // 这里用工作台概览占位，保证模板本身可编译、可预览：
  const data = await getWorkbenchSummary();
  return { total: (data.todos || []).length, list: data.todos || [] };
}

/** 详情 */
export async function getRecord(id) {
  // TODO return getSomethingDetail(id);
  void id;
  return null;
}

/** 保存：create / update 由后端按 id 是否存在区分 */
export async function saveRecord(values) {
  // TODO return saveSomething(values);
  void values;
  throw new Error("请先在 api/oa.js 增加对应接口，再在这里接入");
}

/** 动作：submit / finish / reopen … 载荷只带动作需要的字段 */
export async function runAction(id, action, payload = {}) {
  // TODO return postSomethingAction({ id, action, ...payload });
  void id;
  void action;
  void payload;
  throw new Error("请先在 api/oa.js 增加对应动作接口，再在这里接入");
}

export default { listRecords, getRecord, saveRecord, runAction };
