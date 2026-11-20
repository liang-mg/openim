import axios from "axios";

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
export type DayStateCode = "done" | "partial" | "absent" | "in_progress" | "rest" | "not_yet";

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
/** draft 草稿 · submitted 待组长查阅 · pending_leader 待领导查阅 · archived 已归档 */
export type ReportStatus = "draft" | "submitted" | "pending_leader" | "archived";

export interface ReportContent {
  done: string;
  plan: string;
  issues: string;
}

export interface ReviewInfo {
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

/** 审阅视角：manager 组长 · leader 领导 */
export type ReviewView = "manager" | "leader";

export type OaRole = "employee" | "manager" | "leader" | "hr" | "admin";

/** 当前登录人的 OA 身份，前端据此决定显示组长还是领导视角 */
export interface OaIdentity {
  user_id: string;
  real_name: string;
  department: string;
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
}

/** 员工管理页的列表项，比 OaIdentity 多带 IM 侧的手机号 */
export interface EmployeeView extends OaIdentity {
  phone_number?: string;
}

// ===================== 请假 / 补卡 =====================

export type LeaveType = "personal" | "sick" | "annual" | "compoff" | "business";
export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";

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
  position?: string;
  role: OaRole;
  manager_id?: string;
  is_admin?: boolean;
}

// ===================== 请求封装 =====================

const http = axios.create({
  baseURL: "/oa/api/v1",
  timeout: 20000,
});

http.interceptors.request.use(async (config) => {
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
  /** 30 分钟有效的签名地址，可直接给 img/a 用 */
  signed_url: string;
}

/**
 * 上传附件。走后端统一文件服务（MinIO），返回的 url 才是永久可用的，
 * 之前用 URL.createObjectURL 得到的 blob 地址刷新即失效，领导点下载会 404。
 */
export async function uploadFile(file: File, scope = "report"): Promise<UploadedFile> {
  const form = new FormData();
  form.append("file", file);
  form.append("scope", scope);
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
): Promise<{ total: number; list: CheckinRecord[]; month: string; rule: CheckinRule }> {
  return get<{ total: number; list: CheckinRecord[]; month: string; rule: CheckinRule }>(
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
}): Promise<TeamCheckinResult> {
  const data = await get<TeamCheckinResult>("/checkin/team", {
    month: params.month,
    scope: params.scope || undefined,
    date: params.date || undefined,
    only_exception: params.onlyException ? 1 : undefined,
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
}): Promise<AttendanceReport> {
  const data = await get<AttendanceReport>("/checkin/report", {
    month: params.month,
    scope: params.scope || undefined,
  });
  return { ...data, rows: data.rows || [], warnings: data.warnings || [] };
}

/**
 * 导出出勤报表 CSV。
 * 不能用 window.open：下载要带 token 头，只能走一次带鉴权的请求再存成文件。
 * 服务端已经写了 UTF-8 BOM，Excel 打开中文不会乱码。
 */
export async function downloadAttendanceCsv(month: string, scope?: DataScope): Promise<void> {
  const token = await getChatToken();
  const res = await axios.get("/oa/api/v1/checkin/report", {
    params: { month, scope: scope || undefined, format: "csv" },
    headers: { token: String(token ?? "") },
    responseType: "blob",
    timeout: 60000,
  });
  const blob = new Blob([res.data as BlobPart], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `出勤报表_${month}.csv`;
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

/** 组长 / 领导待查阅列表（服务端按汇报链过滤，越权拿不到） */
export async function getReviewList(
  view: ReviewView,
): Promise<{ total: number; list: ReportRecord[] }> {
  const data = await get<{ total: number; list: ReportRecord[] }>("/report/review-list", { view });
  return { total: data.total, list: (data.list || []).map(normalizeReport) };
}

/** 查阅页：本团队待领导查阅 + 已归档 */
export async function getAllReportsForReview(): Promise<ReportRecord[]> {
  const list = await get<ReportRecord[]>("/report/all-for-review");
  return (list || []).map(normalizeReport);
}

export async function submitReview(
  reportId: string,
  comment: string,
  view: ReviewView,
): Promise<ReviewInfo> {
  return post<ReviewInfo>("/report/review", { report_id: reportId, comment, view });
}

/** 组长上报领导：待组长查阅 → 待领导查阅 */
export async function escalateReport(reportId: string): Promise<void> {
  await post("/report/escalate", { report_id: reportId });
}

/** 领导归档 */
export async function archiveReport(reportId: string): Promise<void> {
  await post("/report/archive", { report_id: reportId });
}

// ===================== 员工与权限管理（仅管理员） =====================

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
  type: LeaveType; start_date: string; end_date: string; reason: string;
}): Promise<LeaveRequest> {
  return post<LeaveRequest>("/leave/submit", params);
}

export async function getLeaveList(params?: {
  scope?: DataScope; status?: RequestStatus;
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
  scope?: DataScope; status?: RequestStatus;
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
