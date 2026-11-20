import axios from "axios";

import { resolveServerURLs } from "@/utils/serverConfig";
import { getChatToken } from "@/utils/storage";

/**
 * OA 业务接口（打卡、工作报告 · 两级审阅）
 *
 * 后端服务：src/xinbo-oa（Go + Gin + MongoDB）
 * 鉴权：复用 IM 的 chatToken，服务端用与 chat 相同的 secret 校验后取出 userID，
 *       company_id 与权限范围全部由服务端根据登录态判定，前端不传也不可信。
 * 响应约定：{ code: 0, msg, data }，code != 0 视为失败。
 */

// ===================== 类型 =====================

export type CheckinType = "on" | "off";
export type CheckinStatus = "normal" | "late" | "early" | "location_abnormal" | "makeup";

export interface CheckinRecord {
  rule_snapshot?: AttendanceRule;
  checkin_id: string;
  checkin_time: number;
  date: string;
  type: CheckinType;
  status: CheckinStatus;
  status_text: string;
  photo_url?: string;
  location_name?: string;
  /** 逆地理编码得到的街道地址，未配置地图 key 时为空 */
  address?: string;
  lat?: number;
  lng?: number;
  /** 距打卡点的直线距离（米），由服务端计算 */
  distance?: number;
  in_fence?: boolean;
  /** 打卡时是否配置了打卡点；false 表示只记录了坐标、没判范围 */
  fence_set?: boolean;
}

/** 打卡点：坐标与半径由服务端下发，前端只用于展示 */
export interface OfficeInfo {
  name: string;
  address: string;
  lat: number;
  lng: number;
  radius: number;
  strict: boolean;
  /** false = 部署方还没配打卡点，不做范围判定 */
  configured: boolean;
}

export interface LocateResult {
  lat: number;
  lng: number;
  address: string;
  distance: number;
  in_fence: boolean;
  fence_set: boolean;
  office: OfficeInfo;
}

export interface TodayCheckin {
  date: string;
  on: CheckinRecord | null;
  off: CheckinRecord | null;
  can_checkin: boolean;
  rule: CheckinRule;
  office: OfficeInfo;
}

/** 作息规则：上班时间之后打上班卡算迟到，下班时间之前打下班卡算早退 */
export interface CheckinRule {
  workdays?: number[];
  /** 上班时间，默认 09:05 */
  work_on_time: string;
  /** 下班时间，默认 18:00 */
  work_off_time: string;
  late_grace: number;
  earliest_on: string;
  need_photo: boolean;
  need_location: boolean;
}

/** 数据范围：mine 只看自己 · team 汇报链下属 · all 全公司（HR/管理员） */
export type DataScope = "mine" | "team" | "all";

/** 某人某天的状态：in_progress 已上班未下班（不算缺卡）*/
export type DayStateCode = "done" | "partial" | "absent" | "leave" | "in_progress" | "rest" | "not_yet";

export interface DayStatus {
  state: DayStateCode;
  on: CheckinRecord | null;
  off: CheckinRecord | null;
}

export interface MonthStat {
  /** 应出勤天数：本月工作日里已经过完的天数 */
  workdays: number;
  attend: number;
  late: number;
  early: number;
  absent: number;
  partial: number;
  /** 出勤率（百分比） */
  rate: number;
}

export interface TeamMemberRow {
  user_id: string;
  name: string;
  department: string;
  position: string;
  role: string;
  today: DayStatus;
  month: MonthStat;
  /** 今日有异常（缺卡/单卡/迟到/早退），用于排序与过滤 */
  exception: boolean;
}

export interface TeamCheckinResult {
  scope: DataScope;
  month: string;
  date: string;
  rule: CheckinRule;
  /** holiday_calendar_not_integrated = 节假日日历未接入，工作日只按周一至周五判 */
  warnings: string[];
  summary: {
    members: number;
    present: number;
    absent: number;
    late: number;
    early: number;
  };
  members: TeamMemberRow[];
}

export interface ReportRow {
  leave: number;
  makeup: number;
  exceptions: number;
  user_id: string;
  name: string;
  department: string;
  position: string;
  workdays: number;
  attend: number;
  late: number;
  early: number;
  absent: number;
  partial: number;
  rate: number;
  avg_on: string;
  avg_off: string;
}

export interface AttendanceReport {
  scope: DataScope;
  month: string;
  rule: CheckinRule;
  generated_at: string;
  warnings: string[];
  total: ReportRow;
  rows: ReportRow[];
}

export interface MemberCheckin {
  rules_by_date?: Record<string, CheckinRule>;
  approved_leave_days?: Record<string, boolean> | null;
  user: OaIdentity;
  month: string;
  total: number;
  list: CheckinRecord[];
  rule: CheckinRule;
  warnings: string[];
}

export interface SubmitCheckinParams {
  type: CheckinType;
  photo?: string;
  lat?: number;
  lng?: number;
  location_name?: string;
  device_info?: { model?: string; ua?: string };
}

export type ReportType = "daily" | "weekly" | "monthly";
/** draft 草稿 · submitted 待直属上级点评 · pending_leader 待终审 · archived 已归档 */
export type ReportStatus = "draft" | "submitted" | "pending_leader" | "archived";

export interface ReportContent {
  done: string;
  plan: string;
  issues: string;
}

export interface ReviewInfo {
  reviewer_id?: string;
  reviewer_name: string;
  role: "leader" | "manager";
  comment: string;
  review_time: string;
}

export interface ReportAttachment {
  name: string;
  size: number;
  file_type: string;
  url: string;
}

export interface ReportAuthor {
  user_id: string;
  name: string;
  department: string;
}

export interface ReportRecord {
  report_id: string;
  type: ReportType;
  period: string;
  content: ReportContent;
  attachments: ReportAttachment[];
  status: ReportStatus;
  submit_time?: number;
  author: ReportAuthor;
  reviews: ReviewInfo[];
  review_actions?: { can_comment: boolean; can_escalate: boolean; can_archive: boolean };
}

export interface ReportOverview {
  week_submitted: number;
  week_required: number;
  streak_days: number;
  recent: ReportRecord[];
  latest_review?: ReviewInfo;
}

export interface SubmitReportParams {
  type: ReportType;
  period: string;
  content: ReportContent;
  attachments?: ReportAttachment[];
  status: "draft" | "submitted";
}

/** 审阅阶段：manager 直属上级 · leader 终审 */
export type ReviewView = "manager" | "leader";

export type OaRole = "employee" | "manager" | "leader" | "hr" | "admin";

/** 当前登录人的 OA 身份 */
export interface OaIdentity {
  user_id: string;
  real_name: string;
  department: string;
  department_id?: string;
  position: string;
  manager_id: string;
  role: OaRole;
  /** 能否维护员工与权限（与业务角色分开，领导可兼任管理员） */
  is_admin: boolean;
  /** 已停用（离职）：保留历史，但不参与汇报链 */
  disabled: boolean;
  /** 名下直属下属人数（服务端计算，决定要不要显示「团队」视图） */
  subordinate_count?: number;
  /** 是否能看到团队出勤/报表 —— 前端不自己按角色判断 */
  can_view_team?: boolean;
  /** 是否能看到全公司（HR / 管理员） */
  can_view_all?: boolean;
  can_review_attendance?: boolean;
}

export interface DepartmentOption {
  department_id: string;
  name: string;
  parent_id: string;
}

export interface Department extends DepartmentOption {
  head_id: string;
}

export interface DepartmentList {
  list: Department[];
  unlinked: { name: string; count: number }[];
}

export interface OperationAudit {
  audit_id: string;
  actor_id: string;
  occurred_at: number;
  action: string;
  target_id: string;
  result: string;
  changes?: { field: string; before?: string | number | boolean; after?: string | number | boolean }[];
}

export interface ContractAttachment {
  file_id: string;
  name: string;
}

export interface EmployeeContract {
  employee_id: string;
  start_date: string;
  end_date: string;
  attachments?: ContractAttachment[];
  updated_by: string;
  updated_at: number;
  status: "upcoming" | "active" | "expiring" | "expired";
}

/** 员工管理页的列表项，比 OaIdentity 多带 IM 侧的手机号 */
export interface EmployeeView extends OaIdentity {
  phone_number?: string;
}

// ===================== 请假 / 补卡 =====================

export type LeaveType = "personal" | "sick" | "annual" | "compoff" | "business";
export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveAttachment {
  file_id: string;
  name: string;
}

export interface LeaveRequest {
  leave_id: string;
  user_id: string;
  user_name: string;
  department: string;
  type: LeaveType;
  start_date: string;
  end_date: string;
  days: number;
  reason: string;
  attachments?: LeaveAttachment[];
  status: RequestStatus;
  approver_id: string;
  approver_name: string;
  comment: string;
  submitted_at: number;
  approved_at: number;
}

export interface MakeupRequest {
  makeup_id: string;
  user_id: string;
  user_name: string;
  department: string;
  date: string;
  type: CheckinType;
  time: string;
  reason: string;
  status: RequestStatus;
  approver_id: string;
  approver_name: string;
  comment: string;
  checkin_id: string;
  submitted_at: number;
  approved_at: number;
}

export interface AttendancePending {
  leave: number;
  makeup: number;
  reports: number;
}

export const LEAVE_TYPE_TEXT: Record<LeaveType, string> = {
  personal: "事假", sick: "病假", annual: "年假", compoff: "调休", business: "出差",
};

export const REQUEST_STATUS_TEXT: Record<RequestStatus, string> = {
  pending: "待审批", approved: "已通过", rejected: "已拒绝", cancelled: "已撤销",
};

/** 可添加为员工的 IM 账号 */
export interface IMUserOption {
  user_id: string;
  nickname: string;
  phone_number: string;
  has_profile: boolean;
}

export interface EmployeeListResult {
  total: number;
  list: EmployeeView[];
  departments: string[];
}

/** 工作台待办：数量与文案都由服务端按真实数据和角色算，前端不自己拼 */
export interface WorkbenchTodo {
  key: string;
  dot: string;
  text: string;
  action: string;
  path: string;
}

export interface WorkbenchCheckin {
  has_on: boolean;
  has_off: boolean;
  on_time: string;
  off_time: string;
  on_status: string;
  off_status: string;
  location: string;
  btn_text: string;
}

export interface WorkbenchReport {
  submitted: boolean;
  status: ReportStatus | "";
  period: string;
}

export interface WorkbenchSummary {
  todos: WorkbenchTodo[];
  count: number;
  checkin: WorkbenchCheckin;
  report: WorkbenchReport;
}

export interface SaveEmployeeParams {
  user_id: string;
  real_name: string;
  department: string;
  department_id?: string;
  position?: string;
  role: OaRole;
  manager_id?: string;
  is_admin?: boolean;
}

// ===================== 请求封装 =====================

const http = axios.create({
  baseURL: resolveServerURLs().oaApi,
  timeout: 20000,
});

http.interceptors.request.use(async (config) => {
  // 每次请求刷新 OA 地址：桌面端登录页填的 host 在模块加载时还读不到
  config.baseURL = resolveServerURLs().oaApi;
  const token = await getChatToken();
  config.headers.token = token ?? "";
  return config;
});

http.interceptors.response.use(
  (res) => {
    const body = res.data as { code: number; msg?: string; data?: unknown };
    if (body.code !== 0) {
      return Promise.reject(new Error(body.msg || "请求失败"));
    }
    // 直接透出业务 data，下面的 get/post 再断言成具体类型
    return body.data as unknown as typeof res;
  },
  (err) => Promise.reject(err),
);

const get = <T>(path: string, params?: Record<string, unknown>) =>
  http.get(path, { params }) as unknown as Promise<T>;

const post = <T>(path: string, data?: unknown) =>
  http.post(path, data) as unknown as Promise<T>;

/** 后端可能返回 null 的数组字段，统一兜底成空数组，避免页面 .map/.find 报错 */
function normalizeReport(r: ReportRecord): ReportRecord {
  return { ...r, attachments: r.attachments || [], reviews: r.reviews || [] };
}

// ===================== 身份 =====================

export async function getMe(): Promise<OaIdentity> {
  return get<OaIdentity>("/me");
}

/** 工作台首页：今日打卡 + 今日日报 + 真实待办 */
export async function getWorkbenchSummary(): Promise<WorkbenchSummary> {
  const data = await get<WorkbenchSummary>("/workbench/summary");
  return { ...data, todos: data.todos || [] };
}

// ===================== 文件 =====================

export interface UploadedFile {
  file_id: string;
  name: string;
  size: number;
  mime: string;
  /** 规范地址（需带 token 才能下），存进日报附件用这个 */
  url: string;
  /** 支持签名访问的文件会返回 30 分钟有效的地址 */
  signed_url?: string;
}

/**
 * 上传附件。走后端统一文件服务（MinIO），返回的 url 才是永久可用的，
 * 之前用 URL.createObjectURL 得到的 blob 地址刷新即失效，领导点下载会 404。
 */
export async function uploadFile(file: File, scope = "report", contractEmployeeId?: string): Promise<UploadedFile> {
  const form = new FormData();
  form.append("file", file);
  form.append("scope", scope);
  if (contractEmployeeId) form.append("contract_employee_id", contractEmployeeId);
  return http.post("/files/upload", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 60000,
  }) as unknown as Promise<UploadedFile>;
}

/** 换取文件的临时签名地址（30 分钟），用于预览和下载 */
export async function getFileLink(
  fileId: string,
): Promise<{ signed_url: string; name: string; size: number; mime: string }> {
  return get(`/files/${fileId}/link`);
}

/** 从 /oa/api/v1/files/xxx 里取出 file_id */
export function fileIdOf(url: string): string {
  const m = /\/files\/([^/?#]+)/.exec(url || "");
  return m ? m[1] : "";
}

// ===================== 打卡 =====================

export async function getTodayCheckin(): Promise<TodayCheckin> {
  return get<TodayCheckin>("/checkin/today");
}

/**
 * 定位解析：把浏览器 GPS 坐标交给服务端，换回地址 + 距打卡点距离 + 是否在范围内。
 * 距离判定必须在服务端做，前端算出来的值不可信。
 */
export async function locateCheckin(lat: number, lng: number): Promise<LocateResult> {
  return get<LocateResult>("/checkin/locate", { lat, lng });
}

export async function submitCheckin(params: SubmitCheckinParams): Promise<CheckinRecord> {
  return post<CheckinRecord>("/checkin/submit", params);
}

export async function getCheckinList(
  month: string,
  page = 1,
  pageSize = 30,
): Promise<{
  total: number; list: CheckinRecord[]; month: string; rule: CheckinRule;
  rules_by_date?: Record<string, CheckinRule>;
  approved_leave_days?: Record<string, boolean> | null;
}> {
  return get(
    "/checkin/list",
    { month, page, page_size: pageSize },
  );
}

/**
 * 团队出勤：组长/领导看下属今天来没来 + 本月表现。
 * 范围由服务端按汇报链算，越权返回 403（不是空列表）。
 */
export async function getTeamCheckin(params: {
  month: string;
  scope?: DataScope;
  date?: string;
  onlyException?: boolean;
  departmentId?: string;
}): Promise<TeamCheckinResult> {
  const data = await get<TeamCheckinResult>("/checkin/team", {
    month: params.month,
    scope: params.scope || undefined,
    date: params.date || undefined,
    only_exception: params.onlyException ? 1 : undefined,
    department_id: params.departmentId,
  });
  return { ...data, members: data.members || [], warnings: data.warnings || [] };
}

/** 看某个成员的月历（只读）。越权/停用都会 403。 */
export async function getMemberCheckin(
  userId: string,
  month: string,
): Promise<MemberCheckin> {
  const data = await get<MemberCheckin>(`/checkin/team/${userId}`, { month });
  return { ...data, list: data.list || [] };
}

/** 出勤报表：一人一行 + 合计行 */
export async function getAttendanceReport(params: {
  month: string;
  scope?: DataScope;
  departmentId?: string;
}): Promise<AttendanceReport> {
  const data = await get<AttendanceReport>("/checkin/report", {
    month: params.month,
    scope: params.scope || undefined,
    department_id: params.departmentId,
  });
  return { ...data, rows: data.rows || [], warnings: data.warnings || [] };
}

/**
 * 导出出勤报表。
 * 不能用 window.open：下载要带 token 头，只能走一次带鉴权的请求再存成文件。
 * 服务端已经写了 UTF-8 BOM，Excel 打开中文不会乱码。
 */
export async function downloadAttendanceReport(
  month: string,
  format: "csv" | "xlsx",
  scope?: DataScope,
  departmentId?: string,
): Promise<void> {
  const token = await getChatToken();
  const res = await axios.get(`${resolveServerURLs().oaApi}/checkin/report`, {
    params: { month, scope, format, department_id: departmentId },
    headers: { token: String(token ?? "") },
    responseType: "blob",
    timeout: 60000,
  });
  const blob = res.data as Blob;
  if (blob.type.includes("application/json")) {
    const error = JSON.parse(await blob.text()) as { message?: string; msg?: string };
    throw new Error(error.message || error.msg || "导出失败");
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `出勤报表_${month}.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ===================== 工作报告 =====================

/** 员工端概览：服务端只返回当前登录人自己的日报 */
export async function getReportOverview(): Promise<ReportOverview> {
  const data = await get<ReportOverview>("/report/overview");
  return {
    ...data,
    recent: (data.recent || []).map(normalizeReport),
  };
}

export async function submitReport(params: SubmitReportParams): Promise<ReportRecord> {
  const r = await post<ReportRecord>("/report/submit", params);
  return normalizeReport(r);
}

export async function withdrawReport(reportId: string): Promise<void> {
  await post("/report/withdraw", { report_id: reportId });
}

/** 待查阅列表（服务端按阶段和汇报链过滤） */
export async function getReviewList(
  view: ReviewView,
): Promise<{ total: number; list: ReportRecord[] }> {
  const data = await get<{ total: number; list: ReportRecord[] }>("/report/review-list", { view });
  return { total: data.total, list: (data.list || []).map(normalizeReport) };
}

/** 查阅页的待处理与已归档报告 */
export async function getAllReportsForReview(reportId?: string): Promise<ReportRecord[]> {
  const list = await get<ReportRecord[]>("/report/all-for-review", { report_id: reportId });
  return (list || []).map(normalizeReport);
}

export async function submitReview(
  reportId: string,
  comment: string,
  view: ReviewView,
  complete = false,
): Promise<ReviewInfo> {
  return post<ReviewInfo>("/report/review", { report_id: reportId, comment, view, complete });
}

/** 直属上级上报终审 */
export async function escalateReport(reportId: string): Promise<void> {
  await post("/report/escalate", { report_id: reportId });
}

/** 终审归档 */
export async function archiveReport(reportId: string): Promise<void> {
  await post("/report/archive", { report_id: reportId });
}

// ===================== 员工与权限管理（仅管理员） =====================

export async function getVisibleDepartments(scope: DataScope): Promise<DepartmentOption[]> {
  const { list } = await get<{ list: DepartmentOption[] }>("/organization/departments", { scope });
  return list;
}

export async function getDepartments(): Promise<DepartmentList> {
  return get<DepartmentList>("/admin/departments");
}

export async function getOperationAudit(params: {
  actor_id?: string;
  action?: string;
  from?: string;
  to?: string;
  page?: number;
}): Promise<{ total: number; page_size: number; list: OperationAudit[] }> {
  return get("/admin/audit", params);
}

export async function getEmployeeContract(employeeId: string): Promise<EmployeeContract | null> {
  return get("/admin/contract", { employee_id: employeeId });
}

export async function saveEmployeeContract(params: {
  employee_id: string;
  start_date: string;
  end_date: string;
  updated_at: number;
  attachment_ids: string[];
}): Promise<EmployeeContract> {
  return post("/admin/contract/save", params);
}

export async function downloadContractAttachment(employeeId: string, fileId: string): Promise<Blob> {
  return downloadRecordFile(fileId, { contract_employee_id: employeeId });
}

export async function saveDepartment(params: {
  department_id?: string;
  name?: string;
  parent_id?: string;
  head_id?: string;
}): Promise<Department> {
  return post<Department>("/admin/department/save", params);
}

export async function migrateDepartment(legacyName: string, departmentId: string): Promise<{ linked: number }> {
  return post("/admin/department/migrate", { legacy_name: legacyName, department_id: departmentId });
}

export async function getEmployeeList(params?: {
  keyword?: string;
  department?: string;
  role?: string;
  includeDisabled?: boolean;
}): Promise<EmployeeListResult> {
  return get<EmployeeListResult>("/admin/employees", {
    keyword: params?.keyword || undefined,
    department: params?.department || undefined,
    role: params?.role || undefined,
    include_disabled: params?.includeDisabled ? 1 : undefined,
  });
}

/** 可添加的 IM 账号（已建过档案的 has_profile=true，前端置灰） */
export async function getIMUserCandidates(keyword?: string): Promise<IMUserOption[]> {
  return get<IMUserOption[]>("/admin/im-users", { keyword: keyword || undefined });
}

export async function saveEmployee(params: SaveEmployeeParams): Promise<OaIdentity> {
  return post<OaIdentity>("/admin/employee/save", params);
}

/** 停用/启用（停用不删档，历史日报与点评保留） */
export async function setEmployeeDisabled(userId: string, disabled: boolean): Promise<void> {
  await post("/admin/employee/disable", { user_id: userId, disabled });
}

// ===================== 请假 / 补卡 =====================

export async function submitLeave(params: {
  type: LeaveType; start_date: string; end_date: string; reason: string; attachment_ids?: string[];
}): Promise<LeaveRequest> {
  return post<LeaveRequest>("/leave/submit", params);
}

export async function downloadLeaveAttachment(leaveId: string, fileId: string): Promise<Blob> {
  return downloadRecordFile(fileId, { leave_id: leaveId });
}

async function downloadRecordFile(fileId: string, params: Record<string, string>): Promise<Blob> {
  const token = await getChatToken();
  const { data } = await axios.get<Blob>(`/oa/api/v1/files/${encodeURIComponent(fileId)}`, {
    params,
    headers: { token: typeof token === "string" ? token : "" },
    responseType: "blob",
    timeout: 30000,
  });
  return data;
}

export async function getLeaveList(params?: {
  scope?: DataScope | "assigned"; status?: RequestStatus;
}): Promise<{ total: number; list: LeaveRequest[] }> {
  const q: Record<string, string> = {};
  if (params?.scope) q.scope = params.scope;
  if (params?.status) q.status = params.status;
  return get<{ total: number; list: LeaveRequest[] }>("/leave/list", q);
}

export async function approveLeave(
  leaveId: string, action: "approve" | "reject", comment: string,
): Promise<{ status: RequestStatus }> {
  return post("/leave/approve", { leave_id: leaveId, action, comment });
}

export async function cancelLeave(leaveId: string): Promise<void> {
  await post("/leave/cancel", { id: leaveId });
}

export async function submitMakeup(params: {
  date: string; type: CheckinType; time: string; reason: string;
}): Promise<MakeupRequest> {
  return post<MakeupRequest>("/makeup/submit", params);
}

export async function getMakeupList(params?: {
  scope?: DataScope | "assigned"; status?: RequestStatus;
}): Promise<{ total: number; list: MakeupRequest[] }> {
  const q: Record<string, string> = {};
  if (params?.scope) q.scope = params.scope;
  if (params?.status) q.status = params.status;
  return get<{ total: number; list: MakeupRequest[] }>("/makeup/list", q);
}

export async function approveMakeup(
  makeupId: string, action: "approve" | "reject", comment: string,
): Promise<{ status: RequestStatus; checkin_id: string }> {
  return post("/makeup/approve", { makeup_id: makeupId, action, comment });
}

export async function cancelMakeup(makeupId: string): Promise<void> {
  await post("/makeup/cancel", { id: makeupId });
}

/** 工作台/审批中心的真实待办数（服务端按汇报链算） */
export async function getAttendancePending(scope?: DataScope): Promise<AttendancePending> {
  return get<AttendancePending>("/attendance/pending", scope ? { scope } : undefined);
}

// ===================== 考勤规则 =====================

export interface AttendanceRule {
  department_id?: string;
  effective_date?: string;
  workdays?: number[];
  office?: OfficeInfo;
  work_on_time: string;
  work_off_time: string;
  late_grace: number;
  earliest_on: string;
  need_photo: boolean;
  need_location: boolean;
  makeup_max_days: number;
  makeup_max_month: number;
  updated_by?: string;
  updated_at?: number;
  /** db = 已保存过自定义规则；env = 还在用环境变量默认值 */
  source: "db" | "env";
}

export async function getAttendanceRule(options?: { scope?: "company"; department_id?: string }): Promise<AttendanceRule> {
  return get<AttendanceRule>("/attendance/rule", options);
}

export async function saveAttendanceRule(rule: Omit<AttendanceRule, "source" | "updated_at">) {
  return post<AttendanceRule>("/attendance/rule", rule);
}

// ===================== 考勤异常 =====================

export type ExceptionKind =
  | "absent" | "missing_on" | "missing_off" | "late" | "early" | "outside_fence";
export type ExceptionStatus = "open" | "appealed" | "resolved" | "ignored";

export interface CheckinException {
  exception_id: string;
  user_id: string;
  user_name: string;
  department: string;
  date: string;
  kind: ExceptionKind;
  kind_text: string;
  status: ExceptionStatus;
  note: string;
  checkin_id?: string;
  handler_id?: string;
  handler_name?: string;
  handled_at?: number;
  comment?: string;
  created_at: number;
  updated_at: number;
}

export interface ExceptionSummary {
  open: number;
  appealed: number;
  resolved: number;
  ignored: number;
  total: number;
}

export interface ExceptionListResult {
  scope: DataScope;
  month: string;
  summary: ExceptionSummary;
  total: number;
  list: CheckinException[];
}

export const EXCEPTION_STATUS_TEXT: Record<ExceptionStatus, string> = {
  open: "待处理", appealed: "已申诉", resolved: "已认定", ignored: "已忽略",
};

export async function getExceptionList(params?: {
  scope?: DataScope; month?: string; status?: string; kind?: ExceptionKind;
}): Promise<ExceptionListResult> {
  const q: Record<string, string> = {};
  if (params?.scope) q.scope = params.scope;
  if (params?.month) q.month = params.month;
  if (params?.status) q.status = params.status;
  if (params?.kind) q.kind = params.kind;
  return get<ExceptionListResult>("/checkin/exception/list", q);
}

export async function handleException(
  exceptionId: string, action: "resolve" | "ignore", comment: string,
): Promise<{ status: ExceptionStatus }> {
  return post("/checkin/exception/handle", { exception_id: exceptionId, action, comment });
}

export async function appealException(exceptionId: string, note: string) {
  return post<{ status: ExceptionStatus }>("/checkin/exception/appeal", {
    exception_id: exceptionId, note,
  });
}

export async function scanExceptions(days = 3): Promise<{
  from: string; to: string; scanned: number; created: number; skipped: number;
}> {
  return post(`/checkin/exception/scan?days=${days}`) as Promise<{
    from: string; to: string; scanned: number; created: number; skipped: number;
  }>;
}

// ===================== 审批中心 =====================

export type ApprovalKind = "leave" | "makeup" | "exception" | "report";
export type ApprovalTab = "pending" | "mine" | "done";

export interface ApprovalItem {
  kind: ApprovalKind;
  kind_text: string;
  id: string;
  user_id: string;
  user_name: string;
  department: string;
  title: string;
  subtitle: string;
  status: string;
  time: number;
  can_approve: boolean;
  path: string;
}

export interface ApprovalListResult {
  tab: ApprovalTab;
  total: number;
  list: ApprovalItem[];
  pending: number;
}

export async function getApprovalList(params?: {
  tab?: ApprovalTab; kind?: ApprovalKind; status?: "pending"; scope?: DataScope; departmentId?: string;
}): Promise<ApprovalListResult> {
  const q: Record<string, string> = {};
  if (params?.tab) q.tab = params.tab;
  if (params?.kind) q.kind = params.kind;
  if (params?.status) q.status = params.status;
  if (params?.scope) q.scope = params.scope;
  if (params?.departmentId) q.department_id = params.departmentId;
  return get<ApprovalListResult>("/approvals/list", q);
}

export interface SubmitRateRow {
  department: string;
  total: number;
  submitted: number;
  rate: number;
  missing: string[];
}

export interface SubmitRateResult {
  date: string;
  today: string;
  scope: DataScope;
  total: number;
  done: number;
  rate: number;
  rows: SubmitRateRow[];
}

export async function getSubmitRate(params?: {
  date?: string; scope?: DataScope; departmentId?: string;
}): Promise<SubmitRateResult> {
  const q: Record<string, string> = {};
  if (params?.date) q.date = params.date;
  if (params?.scope) q.scope = params.scope;
  if (params?.departmentId) q.department_id = params.departmentId;
  return get<SubmitRateResult>("/report/submit-rate", q);
}

export interface ManagementDashboardResult {
  date: string;
  month: string;
  scope: DataScope;
  attendance: ReportRow;
  reports: { done: number; total: number; rate: number };
  approvals: number;
  exceptions: number;
  daily_trend: { date: string; count: number }[];
}

export async function getManagementDashboard(
  date: string,
  scope: DataScope,
  departmentId?: string,
): Promise<ManagementDashboardResult> {
  return get<ManagementDashboardResult>("/management/dashboard", { date, scope, department_id: departmentId });
}

export interface UrgeReportResult {
  urged: number;
  skipped: number;
  failed: number;
  pushed: boolean;
  im_succeeded: number;
  im_failed: number;
  im_not_configured: number;
}

export async function urgeReports(date: string, scope?: DataScope): Promise<UrgeReportResult> {
  const path = scope ? `/report/urge?scope=${encodeURIComponent(scope)}` : "/report/urge";
  return post<UrgeReportResult>(path, { date });
}

// ===================== 通知 =====================

export interface OaNotification {
  notification_id: string;
  user_id: string;
  kind: string;
  title: string;
  content: string;
  path: string;
  read: boolean;
  created_at: number;
  im_status?: "pending" | "succeeded" | "failed" | "not_configured";
}

export async function getNotifications(all = false): Promise<{
  total: number; unread: number; list: OaNotification[]; push_enabled: boolean;
}> {
  return get("/notifications/list", all ? { all: 1 } : undefined);
}

export async function readNotifications(id?: string): Promise<{ updated: number }> {
  return post("/notifications/read", id ? { notification_id: id } : { all: true });
}

export interface Announcement {
  announcement_id: string;
  title: string;
  content?: string;
  scope: "company" | "department";
  department_id?: string;
  department_name?: string;
  publisher_name: string;
  published_at: number;
}

export interface AnnouncementSummary extends Announcement {
  recipient_count: number;
  read_count: number;
}

export interface AnnouncementRecipient {
  user_id: string;
  name: string;
  read_at?: number;
}

export type AnnouncementReceipts = AnnouncementSummary & { recipients: AnnouncementRecipient[] };

export function getAnnouncement(id: string): Promise<Announcement> {
  return get(`/announcements/${encodeURIComponent(id)}`);
}

export function readAnnouncement(id: string): Promise<{ read_at: number }> {
  return post(`/announcements/${encodeURIComponent(id)}/read`, {});
}

export function getPublishedAnnouncements(): Promise<{ list: AnnouncementSummary[] }> {
  return get("/admin/announcements");
}

export function getAnnouncementReceipts(id: string): Promise<AnnouncementReceipts> {
  return get(`/admin/announcements/${encodeURIComponent(id)}/receipts`);
}

export function publishAnnouncement(values: {
  title: string;
  content: string;
  scope: Announcement["scope"];
  department_id?: string;
}): Promise<{ announcement_id: string; recipient_count: number; notified: number; notification_failures: number }> {
  return post("/admin/announcements", values);
}

// ===================== 工具 =====================

export function reportTypeText(type: ReportType) {
  const map: Record<ReportType, string> = { daily: "日报", weekly: "周报", monthly: "月报" };
  return map[type] || "日报";
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
