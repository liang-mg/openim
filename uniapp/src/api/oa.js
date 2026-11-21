/**
 * OA 业务接口层 —— 与 frontend/src/api/oaApi.ts 一一对应（函数名、路径、参数保持一致）。
 *
 * 为什么要 1:1 对齐：三端一致性靠「同一份接口契约」保证，而不是靠各写一遍。
 * 迁移页面时，PC 端调用哪个函数，这里同名同参，出问题可以逐行对账。
 *
 * 响应信封与鉴权见 utils/request.js。
 */
import { get, post, uploadFile as upload, request } from "@/utils/request";
import { CONFIG } from "@/config";
import { getToken } from "@/utils/storage";

// ===================== 文案常量 =====================

export const LEAVE_TYPE_TEXT = {
  personal: "事假",
  sick: "病假",
  annual: "年假",
  compoff: "调休",
  business: "出差",
};

export const REQUEST_STATUS_TEXT = {
  pending: "待审批",
  approved: "已通过",
  rejected: "已驳回",
  cancelled: "已撤销",
};

export const EXCEPTION_STATUS_TEXT = {
  open: "待处理",
  appealed: "已申诉",
  resolved: "已处理",
  ignored: "已忽略",
};

export function reportTypeText(type) {
  const map = { daily: "日报", weekly: "周报", monthly: "月报" };
  return map[type] || "日报";
}

// PC 端 oaApi.ts 把这两个工具函数也放在同一文件里导出，
// 这里保持同名导出（实现复用在 utils/format.js），守卫脚本据此校验契约对齐。
export { formatFileSize } from "@/utils/format";

// ===================== 身份 =====================

export const getMe = () => get("/me");

export const getWorkbenchSummary = async () => {
  const data = await get("/workbench/summary");
  return { ...data, todos: data.todos || [] };
};

// ===================== 文件 =====================

/** @param {string} filePath uni.chooseImage/chooseFile 得到的临时路径 */
export const uploadFile = (filePath, scope = "report") => upload(filePath, scope);

export const getFileLink = (fileId) => get(`/files/${fileId}/link`);

/** 从规范地址里取出 file_id（PC 端同样的正则） */
export function fileIdOf(url) {
  if (!url) return "";
  const m = String(url).match(/\/files\/([^/?#]+)/);
  return m ? m[1] : "";
}

// ===================== 打卡 =====================

export const getTodayCheckin = () => get("/checkin/today");

/** 定位解析：坐标交给服务端换地址 + 距离 + 是否在范围内 */
export const locateCheckin = (lat, lng) => get("/checkin/locate", { lat, lng });

export const submitCheckin = (params) => post("/checkin/submit", params);

export const getCheckinList = (month, page = 1, pageSize = 30) =>
  get("/checkin/list", { month, page, page_size: pageSize });

export const getTeamCheckin = async ({ month, scope, date, onlyException }) => {
  const data = await get("/checkin/team", {
    month,
    scope: scope || undefined,
    date: date || undefined,
    only_exception: onlyException ? 1 : undefined,
  });
  return { ...data, members: data.members || [], warnings: data.warnings || [] };
};

export const getMemberCheckin = async (userId, month) => {
  const data = await get(`/checkin/team/${userId}`, { month });
  return { ...data, list: data.list || [] };
};

export const getAttendanceReport = async ({ month, scope }) => {
  const data = await get("/checkin/report", { month, scope: scope || undefined });
  return { ...data, rows: data.rows || [], warnings: data.warnings || [] };
};

// ===================== 工作报告 =====================

export const getReportOverview = () => get("/report/overview");

export const submitReport = async (params) => {
  const r = await post("/report/submit", params);
  return { ...r, attachments: r.attachments || [], reviews: r.reviews || [] };
};

export const withdrawReport = (reportId) => post("/report/withdraw", { report_id: reportId });

export const getReviewList = async (params) => {
  const data = await get("/report/review-list", params);
  return { ...data, list: data.list || [] };
};

export const getAllReportsForReview = async (reportId) => {
  const list = await get("/report/all-for-review", reportId ? { report_id: reportId } : undefined);
  return list || [];
};

/** 与 PC 同签名：submitReview(reportId, comment, view, complete) */
export const submitReview = (reportId, comment, view, complete = false) =>
  post("/report/review", { report_id: reportId, comment, view, complete });

export const escalateReport = (reportId) => post("/report/escalate", { report_id: reportId });

export const archiveReport = (reportId) => post("/report/archive", { report_id: reportId });

// ===================== 员工与权限（管理员） =====================

/** 员工列表。注意后端参数是 snake_case 的 include_disabled，前端用 includeDisabled */
export const getEmployeeList = (params = {}) =>
  get("/admin/employees", {
    keyword: params.keyword || undefined,
    department: params.department || undefined,
    role: params.role || undefined,
    include_disabled: params.includeDisabled ? 1 : undefined,
  });

export const getIMUserCandidates = (keyword) =>
  get("/admin/im-users", { keyword: keyword || undefined });

export const saveEmployee = (params) => post("/admin/employee/save", params);

export const setEmployeeDisabled = (userId, disabled) =>
  post("/admin/employee/disable", { user_id: userId, disabled });

// ===================== 请假 / 补卡 =====================

export const submitLeave = (params) => post("/leave/submit", params);

export const getLeaveList = async (params) => {
  const data = await get("/leave/list", params);
  return { ...data, list: data.list || [] };
};

export const approveLeave = ({ leaveId, action, comment }) =>
  post("/leave/approve", { leave_id: leaveId, action, comment });

export const cancelLeave = (leaveId) => post("/leave/cancel", { id: leaveId });

export const submitMakeup = (params) => post("/makeup/submit", params);

export const getMakeupList = async (params) => {
  const data = await get("/makeup/list", params);
  return { ...data, list: data.list || [] };
};

export const approveMakeup = ({ makeupId, action, comment }) =>
  post("/makeup/approve", { makeup_id: makeupId, action, comment });

export const cancelMakeup = (makeupId) => post("/makeup/cancel", { id: makeupId });

export const getAttendancePending = (scope) =>
  get("/attendance/pending", scope ? { scope } : undefined);

export const getAttendanceRule = () => get("/attendance/rule");

export const saveAttendanceRule = (rule) => post("/attendance/rule", rule);

// ===================== 考勤异常 =====================

export const getExceptionList = async (params) => {
  const data = await get("/checkin/exception/list", params);
  return { ...data, list: data.list || [] };
};

export const handleException = ({ exceptionId, action, comment }) =>
  post("/checkin/exception/handle", { exception_id: exceptionId, action, comment });

export const appealException = (exceptionId, note) =>
  post("/checkin/exception/appeal", {
    exception_id: exceptionId,
    note,
  });

export const scanExceptions = (days = 3) =>
  request({ path: `/checkin/exception/scan?days=${days}`, method: "POST" });

// ===================== 审批中心 =====================

export const getApprovalList = async (params) => {
  const data = await get("/approvals/list", params);
  return { ...data, list: data.list || [] };
};

export const getSubmitRate = (params) => get("/report/submit-rate", params);

export const urgeReports = (date, scope) => {
  // 与 PC 一致：带 scope 时把 scope 拼进 query，否则走裸路径
  const path = scope ? `/report/urge?scope=${encodeURIComponent(scope)}` : "/report/urge";
  return post(path, { date });
};

// ===================== 通知 =====================

export const getNotifications = (all = false) =>
  get("/notifications/list", all ? { all: 1 } : undefined);

export const readNotifications = (id) =>
  post("/notifications/read", id ? { notification_id: id } : { all: true });

// ===================== 与 PC 对齐（2026-11-20 桌面端 PR 新增） =====================
//
// 这批函数移动端页面暂时没用到，但契约要求「PC 有、移动端必须同名同路径」，
// 否则守卫 guard-contract 会失败，也意味着后续迁页面时会各写一套。
// 移动端差异只在“下载类”：PC 返回 Blob 并触发浏览器下载，这里返回临时文件路径，
// 由调用方决定 openDocument / 保存（uni 没有 Blob）。

/** 统一下载：带 token 取文件，返回本地临时路径 */
function downloadRecordFile(fileId, params = {}) {
  const query = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== "")
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join("&");
  const path = `/oa/api/v1/files/${encodeURIComponent(fileId)}${query ? `?${query}` : ""}`;
  const url = path.startsWith("/") && CONFIG.origin ? `${CONFIG.origin}${path}` : path;
  return new Promise((resolve, reject) => {
    uni.downloadFile({
      url,
      header: { token: getToken() || "" },
      success: (res) => {
        if (res.statusCode === 200) resolve(res.tempFilePath);
        else reject(new Error(`下载失败（${res.statusCode}）`));
      },
      fail: () => reject(new Error("下载失败，请检查网络")),
    });
  });
}

/** 出勤报表导出（PC: void；移动端返回临时文件路径） */
export function downloadAttendanceReport(month, format, scope, departmentId) {
  const params = { month, scope, format, department_id: departmentId };
  const query = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== "")
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join("&");
  const path = `/oa/api/v1/checkin/report?${query}`;
  const url = CONFIG.origin ? `${CONFIG.origin}${path}` : path;
  return new Promise((resolve, reject) => {
    uni.downloadFile({
      url,
      header: { token: getToken() || "" },
      success: (res) => {
        if (res.statusCode === 200) resolve(res.tempFilePath);
        else reject(new Error(`导出失败（${res.statusCode}）`));
      },
      fail: () => reject(new Error("导出失败，请检查网络")),
    });
  });
}

export const downloadLeaveAttachment = (leaveId, fileId) => downloadRecordFile(fileId, { leave_id: leaveId });

export const downloadContractAttachment = (employeeId, fileId) =>
  downloadRecordFile(fileId, { contract_employee_id: employeeId });

export const locateCheckinByIp = (hint) =>
  get("/checkin/locate-by-ip", hint ? { ip: hint.ip, lat: hint.lat, lng: hint.lng, address: hint.address } : undefined);

export const getVisibleDepartments = async (scope) => {
  const data = await get("/organization/departments", { scope });
  return data.list || [];
};

export const getDepartments = () => get("/admin/departments");

export const saveDepartment = (params) => post("/admin/department/save", params);

export const migrateDepartment = (legacyName, departmentId) =>
  post("/admin/department/migrate", { legacy_name: legacyName, department_id: departmentId });

export const getOperationAudit = (params) => get("/admin/audit", params);

export const getEmployeeContract = (employeeId) => get("/admin/contract", { employee_id: employeeId });

export const saveEmployeeContract = (params) => post("/admin/contract/save", params);

export const getManagementDashboard = (date, scope, departmentId) =>
  get("/management/dashboard", { date, scope, department_id: departmentId });

export const getAnnouncement = (id) => get(`/announcements/${encodeURIComponent(id)}`);

export const readAnnouncement = (id) => post(`/announcements/${encodeURIComponent(id)}/read`, {});

export const getPublishedAnnouncements = () => get("/admin/announcements");

export const getAnnouncementReceipts = (id) => get(`/admin/announcements/${encodeURIComponent(id)}/receipts`);

export const publishAnnouncement = (values) => post("/admin/announcements", values);
