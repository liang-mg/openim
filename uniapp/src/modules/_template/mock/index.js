/**
 * 模块 Mock：内存假数据，**只给独立验证用**，不进页面运行链路。
 *
 * 红线（照搬消防项目的 Mock 边界）：
 *   - 不模拟登录、权限、审批事实；
 *   - 不写真实存储；
 *   - 页面不得自动回退到 Mock（请求失败就是失败，要让人看见）。
 */

const SEEDS = [
  { id: "T-001", title: "示例单据一", status: "draft", owner: "李然", remark: "模板数据", created_at: 1795000000000 },
  { id: "T-002", title: "示例单据二", status: "submitted", owner: "张明", remark: "", created_at: 1795003600000 },
];

let rows = SEEDS.map((r) => ({ ...r }));

export function reset() {
  rows = SEEDS.map((r) => ({ ...r }));
}

export async function list({ page = 1, pageSize = 20, keyword = "", status = "" } = {}) {
  let data = rows.slice();
  if (keyword) data = data.filter((r) => `${r.title}${r.owner}`.includes(keyword));
  if (status) data = data.filter((r) => r.status === status);
  const start = (page - 1) * pageSize;
  return { total: data.length, list: data.slice(start, start + pageSize) };
}

export async function detail(id) {
  return rows.find((r) => r.id === id) || null;
}

export async function action(id, act) {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error("记录不存在");
  if (act === "submit") row.status = "submitted";
  else if (act === "finish") row.status = "done";
  else if (act === "reopen") row.status = "draft";
  else throw new Error(`未知动作 ${act}`);
  return { ...row };
}

export default { reset, list, detail, action };
