/**
 * 模块定义：字段、状态、动作、校验 —— 只声明，不执行。
 *
 * 为什么要这一层：页面渲染、表单校验、列表筛选都从这份声明推导，
 * 避免同一套规则在列表页、详情页、编辑页各写一遍（改一处漏两处）。
 * 参考 `uniapp/.dsh/skills/qianso-uniapp-fire` 的 definition 模式。
 */

/** 字段声明：key 与后端返回字段完全一致（移动端不另起名字） */
export const FIELDS = [
  { key: "id", label: "编号", type: "text", list: true, detail: true },
  { key: "title", label: "标题", type: "text", list: true, detail: true, required: true, max: 60 },
  { key: "status", label: "状态", type: "status", list: true, detail: true },
  { key: "owner", label: "负责人", type: "text", list: true, detail: true },
  { key: "remark", label: "备注", type: "textarea", list: false, detail: true, max: 200 },
  { key: "created_at", label: "创建时间", type: "datetime", list: true, detail: true },
];

/** 状态字典：值 → 文案 + 色调（色调由组件映射成类名） */
export const STATUS = {
  draft: { label: "草稿", tone: "muted" },
  submitted: { label: "已提交", tone: "info" },
  done: { label: "已完成", tone: "success" },
};

/** 状态迁移：只允许服务端允许的动作；前端不推断权限，仅用于展示按钮可见性 */
export const ACTIONS = [
  { key: "submit", label: "提交", from: ["draft"], tone: "primary" },
  { key: "finish", label: "完成", from: ["submitted"], tone: "primary" },
  { key: "reopen", label: "退回", from: ["done"], tone: "danger" },
];

/** 列表页用哪些字段 */
export const LIST_FIELDS = FIELDS.filter((f) => f.list);

/** 详情页用哪些字段 */
export const DETAIL_FIELDS = FIELDS.filter((f) => f.detail);

/**
 * 校验：只校验「当前动作实际提交的字段」。
 * 返回 [{ key, message }]，空数组表示通过。
 */
export function validate(values = {}, action = "save") {
  const errors = [];
  for (const field of FIELDS) {
    if (!field.required) continue;
    if (action === "submit" && field.key === "remark") continue; // 提交不强制备注
    const value = values[field.key];
    if (value === undefined || value === null || value === "") {
      errors.push({ key: field.key, message: `${field.label}不能为空` });
    } else if (field.max && String(value).length > field.max) {
      errors.push({ key: field.key, message: `${field.label}不能超过 ${field.max} 字` });
    }
  }
  return errors;
}

/** 当前状态可执行的动作（进一步是否可点由服务端 allowedActions 决定） */
export function actionsOf(status) {
  return ACTIONS.filter((a) => a.from.includes(status));
}

export default { FIELDS, STATUS, ACTIONS, LIST_FIELDS, DETAIL_FIELDS, validate, actionsOf };
