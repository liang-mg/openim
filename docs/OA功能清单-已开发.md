# OA 已开发功能表

> 更新：2026-11-20 · 对应提交 `3514b70`（`liang-mg/openim` main，含合并的 PR #1「PC 端开发批次 1~4」）
> 读者：要接手、联调或验收这套 OA 的同事。
> 用法：先看第一节「一分钟总览」定位模块，再看第二节该模块的入口/接口/表/权限，第七节是还没做的部分——**不要把它当成"全部做完了"**。
>
> 本轮变化（`3514b70`）：合并同事 PR，落地了原第七节列的**部门树、部门级规则、xlsx 导出、数据看板、操作审计、公告+已读回执、员工合同/到期提醒**，以及**请假附件、打卡规则快照、人脸照片上限 300KB** 等。上一版清单中"未做"的 P2-1 / P3-1~P3-4 现已完成，第七节已同步更新。

---

## 一、一分钟总览

18 个模块，全部已有前后端和回归脚本，页面入口都是 hash 路由（`http://<host>/#/<path>`）。

| # | 模块 | 一句话能力 | 页面入口 | 主要使用者 |
|---|---|---|---|---|
| 1 | 工作台 | 真实待办（6 类）+ 今日打卡状态 + 日报状态 | `#/work` | 全员 |
| 2 | 拍照打卡 | 真实 GPS + 服务端判围栏 + 照片水印；桌面端 GPS 超时自动 IP 兜底 | `#/checkin` | 全员 |
| 3 | 出勤记录 | 我的 / 团队 / 报表 / 全公司四档，月历 + CSV + **xlsx** | `#/attendance` | 全员（按权限出档） |
| 4 | 请假申请 | 提交（**可带附件**）→ 组长批 → 计入考勤口径 | `#/leave` | 全员 |
| 5 | 补卡申请 | 忘打卡补录，通过后生成真实打卡记录 | `#/leave`（补卡页签） | 全员 |
| 6 | 日报 | 提交 / 附件 / 2 小时撤回 / 补写 | `#/report` | 全员 |
| 7 | 日报查阅 | 组长点评上报 → 领导点评归档 | `#/report-review` | 组长 / 领导 |
| 8 | 审批中心 | 四类待办一处处理 + 异常申诉 + 催交 | `#/approvals` | 全员（按权限出页签） |
| 9 | 考勤异常 | 自动扫描漏卡/迟到/范围外，本人申诉、组长认定 | 异常在 `#/approvals`，规则在 `#/oa-admin` | 全员 / 组长 |
| 10 | 考勤规则 | 上下班时间、宽限、补卡次数；**公司级 + 部门级**优先级，改完即生效 | `#/oa-admin` 卡片 | 管理员 |
| 11 | 站内通知 | 审批结果、催交、异常认定落库；可选 IM webhook | `#/announcements` / 工作台 | 全员 |
| 12 | 员工与权限 | 加人 / 改角色 / 设直属上级 / 停用 | `#/oa-admin` | 管理员 |
| 13 | 文件服务 | MinIO 存附件与打卡照片，签名下载，越权 403 | 页面内嵌入 | 全员 |
| **14** | **部门树** | 两级部门 + 负责人 + 成员调配；团队出勤按部门筛选 | `#/oa-admin`（部门管理） | 管理员 / 领导 |
| **15** | **数据看板** | 出勤率 / 提交率 / 待审批量 / 异常趋势统一视图 | `#/management-dashboard` | 领导 / 管理员 |
| **16** | **操作审计** | 改考勤/档案、查阅报告留痕，按人/时间/事件查询 | `#/oa-admin`（操作审计） | 管理员 |
| **17** | **公告 + 已读回执** | 按全公司/部门发布，记录实际收件人与首次阅读时间 | `#/announcements` | 管理员发布 / 全员阅读 |
| **18** | **员工合同** | 合同起止/附件/到期状态，到期前提醒授权 HR | `#/oa-admin`（员工档案） | HR / 管理员 |

**后端接口 59 个**（2 个公开 + 57 个需登录），**OA 自建集合 14 张**（另复用 IM 的 `user` / `attribute` 两张），全部在 `openim_v3` 库、强制带 `company_id` 隔离。本轮新增接口：部门树 4、看板 1、审计 1、公告 5、合同 2、xlsx 导出已并入报表。

**登录方式（2026-11-20 改）**：账号（手机号）+ 密码，邮箱与验证码入口已移除。账号与密码归 IM 管，OA 只复用 chatToken、只存组织关系；六个测试账号与角色见 `docs/OA测试账号与权限说明.md`。管理后台可以给已注册的 IM 账号建档、设角色和上级，停用账号的旧 token 会立即失效。

**桌面端（2026-11-20 新增）**：同一份前端可打 Windows NSIS / macOS dmg 安装包，功能与 Web 端完全一致。服务器地址已内置在程序里，登录页只有账号和密码，不再让同事填地址；Web 端行为不变。桌面端没有 GPS 芯片，系统定位超时会自动用本机公网 IP 做城市级兜底（不判 500 米围栏，来源对组长可见）。打包、分发、地址配置见 `docs/桌面端部署与分发.md` 和 `docs/桌面端-运行时服务器配置设计.md`；定位兜底设计见 `docs/打卡定位-桌面端IP兜底设计.md`。

---

## 二、分模块明细

### 1. 工作台 `#/work`

- **能力**：今日打卡卡（上下班时间 + 状态 + 地点）、今日日报状态、待办列表，点击直达对应页面。
- **待办 6 类，全部来自服务端实时计算**，不是前端假数字：

  | key | 触发条件 | 跳转 |
  |---|---|---|
  | `report` | 工作日且今天日报未提交 | `#/report` |
  | `approval` | 有权限的人（组长及以上）有待处理审批 | `#/approvals` |
  | `exception` | 自己有未处理的考勤异常 | `#/approvals?tab=mine` |
  | `notice` | 有未读站内通知 | `#/approvals?tab=mine` |
  | `checkin` | 工作日未打上班卡，或 18:00 后未打下班卡 | `#/checkin` |
  | `admin` | 管理员：存在没设直属上级的在职成员 | `#/oa-admin` |

- **接口**：`GET /workbench/summary`、`GET /me`
- **权限**：只返回登录人自己的数据；停用账号不再收到任何待办。

### 2. 拍照打卡 `#/checkin`

- **能力**：拍照（前端画水印：姓名/时间/地点）→ 上传 MinIO → 提交打卡；服务端按规则判迟到/早退，按打卡点算距离判是否在范围内。
- **真实性约束**（这几点是刻意设计，不是缺失）：
  - 没有 GPS 坐标不能打卡，没有照片不能打卡——前端不给"模拟照片"这类兜底入口；
  - 前端传的坐标服务端会重算距离，改前端无效；
  - 打卡点默认**不预设**：`XINBO_OA_OFFICE_*` 为空时只记录坐标、不判范围，也不显示任何虚构公司名/地址；部署方填了才启用 500 米围栏。
- **防重复**：同一人同一天同类型（上班/下班）只能一条，重复提交拒绝。
- **可回看**：打卡页时间轴可查看当天照片；组长可调阅组员照片（与日报同一套汇报链权限）。
- **桌面端 IP 兜底**：系统 GPS 超时/失败时，主进程查本机公网 IP + 城市坐标，后端签发凭证后以城市级坐标打卡；`location_accuracy=city` 的记录不判 500 米围栏，组长视角显示「IP 定位」标记。详见 `docs/打卡定位-桌面端IP兜底设计.md`。
- **接口**：`GET /checkin/today`、`GET /checkin/locate`、`GET /checkin/locate-by-ip`、`POST /checkin/submit`、`GET /checkin/list`
- **表**：`oa_checkin`（`type` on/off、`checkin_time`、经纬度、`distance`、`in_fence`、`photo_url`、`photo_file_id`、`device_info`、`source`、`makeup_id`、`location_source`、`location_accuracy`、`client_ip`）

### 3. 出勤记录 `#/attendance`

- **四档视图**，按 `/me` 返回的 `can_view_team` 和角色决定显示几档：

  | 档位 | 看什么 | 谁能看 |
  |---|---|---|
  | 我的出勤 | 月度汇总 + 月历 + 当日明细 + 切月 | 全员 |
  | 团队出勤 | 组员今日上下班 + 本月出勤/迟到/早退/缺卡/出勤率，异常优先排序，可只看异常 | 组长（下属）、领导（整条链） |
  | 出勤报表 | 一人一行 + 合计行，`?format=csv`（带 BOM）或 `?format=xlsx`（真 xlsx）导出 | 组长及以上 |
  | 全公司 | 同上，范围为全公司 | 领导 / 管理员 |

- **口径**：所有档位、CSV、xlsx 都来自同一个 `monthStatOf`；请假日不算缺卡、不计入应出勤分母；今天未到下班点只打了上班卡算 `in_progress`，不算缺卡。统计含出勤天数、批准请假天数、补卡次数、有效异常数。
- **xlsx 与 CSV 同源**：Excel 能直接打开 `.xlsx`，中文列名和数字正常，导出与所选月份/部门/可见范围一致；两种格式共用同一批统计结果。
- **接口**：`GET /checkin/team`、`GET /checkin/team/:user_id`、`GET /checkin/report?format=csv|xlsx`、`GET /checkin/list?month=`
- **越权**：不在自己汇报链的人，`/checkin/team/:user_id` 直接 403。

### 4. 请假 `#/leave`

- **能力**：类型（事假/病假/年假/调休/出差）、起止时间、事由、**附件（走文件服务，按记录权限授权原件）**；提交后可撤销；审批人 = 直属上级，无上级时用部门负责人，再无则领导/管理员可批；不能自己批自己。存量无附件记录仍可读。
- **口径**：请假**不写打卡表**（请假日不是"打了卡"），只影响统计：不算缺卡、不计入应出勤分母，月历上显示"请假"。周末不计天数，跨月按天拆到各自月份。
- **状态机**：`pending → approved / rejected`，`pending` 可 `cancelled`；审批后锁定不可改；在途申请保留原审批人。
- **接口**：`POST /leave/submit`、`GET /leave/list`、`POST /leave/approve`、`POST /leave/cancel`
- **表**：`oa_leave`（`attachments` 存文件引用）

### 5. 补卡 `#/leave`（补卡页签）

- **能力**：选日期 + 时间 + 原因提交，通过后**生成一条 `source=makeup` 的真实打卡记录**（补的是真实事实，必须进打卡表，否则出勤天数对不上）。
- **限制**（读考勤规则，管理员可改）：只能补过去 7 天内、每月最多 3 次、同一天同类型已有卡则拒绝、不能补未来日期。
- **幂等**：审批通过用 upsert 写打卡，重复审批不会写出两条。
- **接口**：`POST /makeup/submit`、`GET /makeup/list`、`POST /makeup/approve`、`POST /makeup/cancel`、`GET /attendance/pending`
- **表**：`oa_makeup`

### 6. 日报 `#/report`

- **能力**：按期（默认当天）写日报，支持附件（走文件服务存 MinIO）、2 小时内撤回、按日期回填、状态可见。
- **状态机**：`draft → submitted → pending_leader → archived`；`submitted` 可撤回；已上报领导后员工不可改；`archived` 永久锁定。
- **接口**：`GET /report/overview`、`POST /report/submit`、`POST /report/withdraw`
- **表**：`oa_report`

### 7. 日报查阅 `#/report-review`

- **能力**：组长看组员待查阅日报并点评，点评后上报领导；领导审阅并归档。两级点评都留痕（点评人、时间、内容）。
- **权限按关系判，不按角色判**：组长自己写的日报由他的上级审，不会出现"组长日报没人能审"。
- **接口**：`GET /report/review-list`、`POST /report/review`、`POST /report/escalate`、`POST /report/archive`、`GET /report/all-for-review`
- **越权**：组长不能归档（返回"无权归档该报告"），不能看别的组。

### 8. 审批中心 `#/approvals`

- **四个页签**：`待我处理` / `我发起的` / `已处理` / `日报提交`。
- **四类事项聚合**：请假、补卡、考勤异常、日报（点评/审阅），**不建冗余表**，直接聚合读取源表。
- **口径唯一**：工作台待办数字和这里的列表调用同一个 `approvalItems()`，工作台只取 `len()`——以前两处各算各的，才会出现"显示 2 条点进去 0 条"。
- **日报提交页签**：按部门看当日提交率（已交/应交），未交名单可一键催交。
- **异常申诉**：本人在"我发起的"里对 `open` 状态的异常申诉。
- **接口**：`GET /approvals/list`、`GET /report/submit-rate`、`POST /report/urge`
- **表**：不新建，聚合 `oa_leave` / `oa_makeup` / `oa_checkin_exception` / `oa_report`

### 9. 考勤异常

- **自动扫描**：服务启动扫一次，之后每 30 分钟扫最近 3 天；只扫工作日、只扫已结束的日期（今天在 18:00 后才扫今天，否则扫到昨天）。
- **六种类型**：`absent`（整日无卡）、`missing_on`（只有下班卡）、`missing_off`（只有上班卡）、`late`（迟到）、`early`（早退）、`outside_fence`（打卡点在范围外）。
- **幂等**：唯一索引 `(company_id, user_id, date, kind)` + `$setOnInsert`，重复扫描不会产生重复记录；被忽略的异常保留，便于年度核对。
- **状态机**：`open → appealed → resolved / ignored`，`open` 也可直接 `resolved / ignored`；处理必须填意见；已处理不可再改。
- **不误报**：已批准请假日不生成缺卡异常；停用成员的历史异常保留但不再进任何人待办；手动扫描最多回溯 31 天。
- **接口**：`POST /checkin/exception/scan`、`GET /checkin/exception/list`、`POST /checkin/exception/handle`、`POST /checkin/exception/appeal`
- **表**：`oa_checkin_exception`

### 10. 考勤规则 `#/oa-admin`（考勤规则卡片）

- **可配**：上班时间、下班时间、迟到宽限（0~120 分钟）、最早上班卡、是否强制照片/定位、工作日、500 米围栏开关、补卡可补天数、每月补卡上限（0 = 不限）。
- **公司级 + 部门级**：取用顺序 **部门级 > 公司级**；部门配了规则就优先用它，没配回落公司级；历史打卡按写入时的 `rule_snapshot` 还原口径。个人规则本轮未纳入（见第七节）。
- **按实际提交路径执行**：照片/定位开关分别控制拦截；关掉后可不传照片或坐标；有坐标且超围栏默认记异常，只有开启严格围栏才拦截提交。
- **生效方式**：管理员保存即生效，60 秒缓存自动刷新，保存时立即失效。
- **刻意不回溯**：规则变更只影响之后的判定，历史打卡记录的 `status` 在写入时已固化，报表数字不会因为改规则而变。
- **降级**：库里没有规则记录时回落到环境变量默认值（09:05 / 18:00），不因缺表报错；页面会提示"正在用默认值"。
- **接口**：`GET /attendance/rule`、`POST /attendance/rule`（均支持 `?department_id=`，`GET` 返回按日期的规则时间线 `rule_timeline`）
- **表**：`oa_attendance_rule`（公司/部门维度）、`oa_attendance_rule_revision`（规则变更留痕）

### 11. 站内通知与公告 `#/announcements`

- **来源**：审批结果、催交、异常认定、合同到期等，落 `oa_notification`；一旦发出就留档，已读只改 `read` 不改内容。网页通知列表可直达有权限的业务记录，标为已读后未读数减少。
- **IM 推送**：配置 `OA_IM_PUSH_URL`（可选 `OA_IM_PUSH_TOKEN`）后，后端额外 POST 到该地址，由部署方对接 chat 系统通知；**没配就只落库并返回 `pushed=false`**，不谎报已推送；Webhook 失败与未配置分别记录，站内通知始终可见。
- **催交去重**：同一人同一业务日期最多一次，且只允许催当天；用唯一索引兜并发，只催授权范围内在职且未交的人。
- **接口**：`GET /notifications/list`、`POST /notifications/read`（公告见第 17 节）
- **表**：`oa_notification`（索引 `company_id + user_id + read + created_at`）

### 12. 员工与权限 `#/oa-admin`

- **能力**：新增员工、改角色（employee / manager / leader）、设直属上级、停用/启用、从 IM 用户里挑人绑定。
- **防错**：防汇报链成环、防把最后一个管理员停掉；只有管理员可见入口，且接口内部再校验一次（不依赖前端隐藏）。
- **接口**：`GET /admin/employees`、`GET /admin/im-users`、`POST /admin/employee/save`、`POST /admin/employee/disable`
- **表**：`oa_employee`

### 13. 文件服务

- **能力**：上传附件与打卡照片到 MinIO（桶 `xinbo-oa`，按公司/年月分目录），前端只存 `file_id`。
- **下载**：`GET /files/:id` 不走鉴权中间件（`<img>` / `<a download>` 带不了 header），改为内部二选一校验——30 分钟短签名（`?u=&e=&s=`）或 header token；越权返回 403。
- **接口**：`POST /files/upload`、`GET /files/:id`（公开路径 + 签名校验）、`GET /files/:id/link`
- **表**：`oa_file`

### 14. 部门树 `#/oa-admin`（部门管理）

- **能力**：两级部门、设负责人、调配成员；团队出勤与报表可按 `department_id` 筛选。
- **规则优先级**：考勤规则取用顺序 **部门级 > 公司级**，部门没配规则才回落到公司级；历史打卡用写入时的 `rule_snapshot` 还原当时口径，不会被新规则改写。
- **迁移**：管理员先把旧部门名称对应到新部门，再批量关联成员；未匹配的保留原部门文本；在途申请保留原审批人，新申请用确认后的默认审批人，禁止自审。
- **接口**：`GET /organization/departments`、`GET /admin/departments`、`POST /admin/department/save`、`POST /admin/department/migrate`
- **表**：`oa_department`（`department_id`、`parent_id`、`leader_id`、成员关系）；`oa_employee` 增 `department_id`

### 15. 数据看板 `#/management-dashboard`

- **能力**：按可见范围（team / all）展示出勤率、日报提交率、待审批量、异常每日趋势，和出勤/日报报表共用同一批取数逻辑，数字一致。
- **权限**：`scope=mine` 直接 403；组长看汇报链、领导看整条链、管理员看全公司；`?department_id=` 只能筛自己可见范围里的部门。
- **接口**：`GET /management/dashboard`（`?scope=&date=&department_id=`）
- **口径**：与 `monthStatOf` / `buildSubmitRate` 同源，不在看板里另算一套。

### 16. 操作审计 `#/oa-admin`（操作审计）

- **能力**：记录操作人、时间、事件、对象和结果（success / denied），管理员按人 / 时间 / 事件查询。
- **九类事件**：员工新增/停用、部门保存/成员迁移、考勤更正、异常认定、日报查阅、合同保存；档案与考勤改动记录必要变更字段。
- **权限**：仅管理员可读，普通员工接口直接 403。
- **接口**：`GET /admin/audit`
- **表**：`oa_operation_audit`

### 17. 公告 + 已读回执 `#/announcements`

- **能力**：管理员按全公司 / 指定部门发布公告；记录**实际收件人**，员工首次阅读写入时间戳，发布者可看已读/未读名单；重复打开不重复计数。
- **权限**：发布/回执列表仅管理员；员工只能看发给自己的公告，看不到别人部门的；阅读回执只写自己那条。
- **接口**：`GET /announcements/:id`、`POST /announcements/:id/read`、`GET /admin/announcements`、`POST /admin/announcements`、`GET /admin/announcements/:id/receipts`
- **表**：`oa_announcement`（含 `receipts` 子文档/集合）

### 18. 员工合同 `#/oa-admin`（员工档案）

- **能力**：授权 HR / 管理员维护合同起止日期、附件、到期状态；临近到期（默认 30 天）通知授权 HR / 管理员一次，续签后按新到期日重算；旧员工资料允许没有合同。
- **权限**：读取/保存都校验 HR 或管理员角色，普通员工与无授权组长无法调阅他人合同附件。
- **接口**：`GET /admin/contract`、`POST /admin/contract/save`
- **表**：`oa_employee_contract`

---

## 三、角色能力矩阵

四个测试账号：李然（员工）、张明（员工）、王强（组长）、王经理（领导 + 管理员）。汇报链：王经理 → 王强 → 李然/张明。

| 功能 | 员工 | 组长 | 领导 | 管理员 |
|---|---|---|---|---|
| 打卡 / 看自己出勤 | 可 | 可 | 可 | 可 |
| 看组员出勤 | 不可 | 汇报链内 | 整条链 | 全公司 |
| 看全公司报表 / CSV | 不可 | 不可 | 可 | 可 |
| 提交请假 / 补卡 / 日报 | 可 | 可 | 可 | 可 |
| 审批下属申请 | 不可 | 直属下属 | 链内 | 链内 + 兜底 |
| 点评 / 上报日报 | 不可 | 组员日报 | 链内 | 链内 |
| 归档日报 | 不可 | 不可（越权拦截） | 可 | 可 |
| 看考勤异常 | 仅自己 | 汇报链内 | 链内统计 | 全公司 |
| 申诉异常 | 仅自己 | 仅自己 | 仅自己 | 仅自己 |
| 处理异常 | 不可 | 链内 | 不可（只看统计） | 可 |
| 改考勤规则（公司/部门级） | 不可 | 不可 | 不可 | 可 |
| 员工与权限管理 | 不可 | 不可 | 不可 | 可 |
| 维护部门树 / 调配成员 | 不可 | 不可 | 不可 | 可 |
| 看数据看板 | 不可（scope=mine 拒绝） | 汇报链内 | 整条链 | 全公司 |
| 看操作审计 | 不可 | 不可 | 不可 | 可 |
| 发布公告 / 看回执 | 不可 | 不可 | 不可 | 可 |
| 读公告 / 写已读回执 | 发给自己的 | 发给自己的 | 发给自己的 | 发给自己的 |
| 维护员工合同 / 看附件 | 不可 | 不可 | 不可 | HR / 管理员 |
| 手动触发异常扫描 | 不可 | 不可 | 不可 | 可 |

> 所有"谁能看谁"统一走后端 `visibleUserIDs(ctx, uid, scope)`，接口里没有一处按角色的 `if`。矩阵实测脚本：`scripts/oa_permission_matrix.js`。

---

## 四、接口清单（共 59 个：2 公开 + 57 需登录）

统一前缀 `/oa/api/v1`，除标注"公开"外都要 `token` 头（IM chatToken）。

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| GET | `/healthz` | 健康检查 | 公开 |
| GET | `/files/:id` | 文件/照片下载（短签名或 token） | 公开路径 + 内部校验 |
| GET | `/me` | 当前身份、角色、是否管理员、可见档位 | 登录 |
| GET | `/workbench/summary` | 工作台待办 + 打卡 + 日报 | 登录 |
| POST | `/files/upload` | 上传附件/照片 | 登录 |
| GET | `/files/:id/link` | 取签名下载链接 | 登录 |
| GET | `/checkin/today` | 今日打卡状态与时间轴 | 登录 |
| GET | `/checkin/locate` | 坐标换地址、算距离、判围栏 | 登录 |
| GET | `/checkin/locate-by-ip` | 桌面端无 GPS 时用公网 IP 取城市级坐标（签发凭证） | 登录 |
| POST | `/checkin/submit` | 提交打卡（服务端重算距离） | 登录 |
| GET | `/checkin/list` | 本人月度打卡流水 | 登录 |
| GET | `/checkin/team` | 团队今日 + 本月汇总 | 组长及以上 |
| GET | `/checkin/team/:user_id` | 成员只读月历 | 汇报链内 |
| GET | `/checkin/report` | 出勤报表，`?format=csv\|xlsx` 导出 | 组长及以上 |
| GET | `/management/dashboard` | 管理看板（出勤率/提交率/待审批/异常趋势） | 组长及以上 |
| GET | `/organization/departments` | 可见部门树 | 登录 |
| POST | `/leave/submit` | 提交请假 | 登录 |
| GET | `/leave/list` | 请假列表（我的/待我批/已处理） | 登录 |
| POST | `/leave/approve` | 审批请假 | 审批人 |
| POST | `/leave/cancel` | 撤销请假 | 本人 |
| POST | `/makeup/submit` | 提交补卡 | 登录 |
| GET | `/makeup/list` | 补卡列表 | 登录 |
| POST | `/makeup/approve` | 审批补卡（通过后写打卡） | 审批人 |
| POST | `/makeup/cancel` | 撤销补卡 | 本人 |
| GET | `/attendance/pending` | 待我审批的请假+补卡合计 | 登录 |
| GET | `/attendance/rule` | 读考勤规则 | 登录 |
| POST | `/attendance/rule` | 保存考勤规则 | 管理员 |
| POST | `/checkin/exception/scan` | 手动触发异常扫描（最多回溯 31 天） | 管理员 |
| GET | `/checkin/exception/list` | 异常列表 | 按可见范围 |
| POST | `/checkin/exception/handle` | 认定属实/不算异常（必填意见） | 组长及以上 |
| POST | `/checkin/exception/appeal` | 本人申诉 | 本人 |
| GET | `/approvals/list` | 审批中心列表（`tab` 四选一） | 登录 |
| GET | `/report/submit-rate` | 日报提交率（按部门） | 组长及以上 |
| POST | `/report/urge` | 一键催交（当天去重） | 组长及以上 |
| GET | `/notifications/list` | 通知列表（`?all=1` 含已读） | 登录 |
| POST | `/notifications/read` | 标记已读（单条或全部） | 登录 |
| GET | `/announcements/:id` | 公告详情（按收件范围鉴权） | 登录 |
| POST | `/announcements/:id/read` | 写本人已读回执（重复不计数） | 登录 |
| GET | `/report/overview` | 日报概览 | 登录 |
| POST | `/report/submit` | 提交/补写日报 | 本人 |
| POST | `/report/withdraw` | 撤回日报（2 小时内） | 本人 |
| GET | `/report/review-list` | 待查阅列表 | 组长及以上 |
| POST | `/report/review` | 点评 | 审阅人 |
| POST | `/report/escalate` | 上报领导 | 组长 |
| POST | `/report/archive` | 归档 | 领导 |
| GET | `/report/all-for-review` | 全量可查阅 | 领导 |
| GET | `/admin/employees` | 员工列表 | 管理员 |
| GET | `/admin/im-users` | IM 用户候选 | 管理员 |
| POST | `/admin/employee/save` | 新增/编辑员工 | 管理员 |
| POST | `/admin/employee/disable` | 停用/启用 | 管理员 |
| GET | `/admin/departments` | 部门列表 | 管理员 |
| POST | `/admin/department/save` | 建/改部门、设负责人 | 管理员 |
| POST | `/admin/department/migrate` | 批量关联成员到部门 | 管理员 |
| GET | `/admin/audit` | 操作审计查询（按人/时间/事件） | 管理员 |
| GET | `/admin/announcements` | 已发布公告 + 回执统计 | 管理员 |
| POST | `/admin/announcements` | 发布公告（全公司/指定部门） | 管理员 |
| GET | `/admin/announcements/:id/receipts` | 公告已读/未读名单 | 管理员 |
| GET | `/admin/contract` | 员工合同详情 | HR / 管理员 |
| POST | `/admin/contract/save` | 维护合同 + 到期提醒 | HR / 管理员 |

---

## 五、数据表（MongoDB `openim_v3`）

OA 自建 14 张；另复用 IM 的 `user` / `attribute` 两张（不在下表）。

| 集合 | 用途 | 关键约束 |
|---|---|---|
| `oa_employee` | 员工档案、角色、`manager_id` 汇报链、`department_id`、停用标记 | `manager_id` 递归防环 |
| `oa_department` | 部门树（两级 + 负责人 + 成员） | `company_id + department_id` 唯一 |
| `oa_checkin` | 打卡不可变记录（含补卡生成的记录 + 规则快照） | 同一人同一天同类型唯一 |
| `oa_checkin_exception` | 考勤异常记录 | 唯一索引 `(company_id, user_id, date, kind)`，扫描幂等 |
| `oa_attendance_rule` | 考勤规则（公司级 + 部门级） | `company_id + department` 维度 |
| `oa_attendance_rule_revision` | 规则变更历史 | 按部门留版本，供时间线取用 |
| `oa_leave` | 请假申请（含附件引用） | 状态机留痕，审批不删记录 |
| `oa_makeup` | 补卡申请 | 通过后 upsert 写 `oa_checkin` |
| `oa_report` | 日报 | `period` + `author.user_id` 定位 |
| `oa_file` | 文件元数据（MinIO key、归属人、大小） | 非本人不可读 |
| `oa_notification` | 站内通知 | 索引 `(company_id, user_id, read, created_at)` |
| `oa_announcement` | 公告 + 已读回执 | 记录实际收件人，首次阅读时间只写一次 |
| `oa_employee_contract` | 员工合同（起止/附件/到期） | 到期提醒只发一次 |
| `oa_operation_audit` | 操作审计（人/时间/事件/对象/结果） | 仅管理员可读 |

---

## 六、怎么验证（同事自查用）

脚本都读环境变量里的地址与账号，默认 `http://127.0.0.1:10010`（接口）和 `http://127.0.0.1:5173`（页面）。**执行前核对接口/DB/账号指向隔离测试环境**——多数脚本会写入业务数据。

| 脚本 | 覆盖内容 | 最近结果 |
|---|---|---|
| `oa_login_check.js` | 账号密码登录（6 账号）+ 角色权限 + 停用即时拦截 + 页面无邮箱/验证码 | 20/20 |
| `oa_desktop_config_check.js` | 桌面端地址派生（标准/反代/端口/归一化）+ 源码一致性 | 33/33 |
| `oa_electron_package_check.js` | 桌面端 asar 依赖闭包完整性 | 39/39 |
| `oa_checkin_ip_check.js` | IP 定位凭证校验、无凭证/篡改拒绝、落库来源字段 | 16/16 |
| `oa_permission_matrix.js` | 四账号权限矩阵实测 | 通过 |
| `oa_e2e_check.js` | 员工提交 → 权限隔离 → 组长点评上报 → 领导归档 | 16/16 |
| `oa_files_check.js` | 上传、鉴权下载、越权 403、签名链接、照片落库 | 16/16 |
| `oa_checkin_geo_check.js` | 打卡定位（有/无打卡点、无定位拒卡） | 15/15 |
| `oa_team_attendance_check.js` | 团队出勤 + 报表权限 12 条 + UI 6 条 | 26/26 |
| `oa_leave_makeup_api_check.js` | 请假/补卡接口、状态机、统计合并 | 通过 |
| `oa_leave_makeup_check.js` | 请假/补卡 UI + 端到端 | 17/17 |
| `oa_exception_check.js` | 异常扫描幂等 + 权限 + 状态机 + 规则缓存 | 20/20 |
| `oa_approval_check.js` | 审批中心聚合口径 + 提交率 + 催交去重 | 20/20 |
| `oa_admin_check.js` | 员工与权限管理接口 | 21/21 |
| `oa_checkin_ui_check.js` / `oa_attendance_ui_check.js` / `oa_files_ui_check.js` / `oa_admin_ui_check.js` | 各页面 UI 回归 | 通过 |
| `backend/ 下 go test ./...` | PR 新增后端测试：部门树/规则时间线/xlsx 导出/审计/公告/合同/请假附件/补卡审批/打卡照片 | 已通过（编译验证） |
| `oa_seed_*.js` | 造演示数据（打卡月历、待办、待审日报） | — |

> 本轮 PR 的**后端 go 测试**已编译通过；浏览器四类角色端到端验收、真实摄像头/定位、外部 IM 联调**尚未执行**，见第七、八节。

一键部署与运维见 `DEPLOY.md`；测试账号与权限说明见 `docs/OA测试账号与权限说明.md`；本轮开发计划与验收清单见 `docs/PC端开发计划1120.md`。

---

## 七、本轮已完成（PR #1，`3514b70`）

上一版清单把这些列在"未做",现已交付:

| 编号 | 功能 | 落地内容 |
|---|---|---|
| P2-1 | 部门树 | 两级部门 + 负责人 + 成员调配，团队出勤/报表可按部门筛 |
| P1-1 | 部门级规则 + 规则快照 | 部门级 > 公司级，历史记录按 `rule_snapshot` 还原；规则变更留痕 |
| P1-4 | 出勤 xlsx 导出 | 真 xlsx，与 CSV/页面同源同口径 |
| P1-2 | 请假附件 | 复用文件服务，按请假记录权限授权原件 |
| P0-2 | 照片 300KB 上限 + 设备信息 | 前端压缩 + 后端同一上限，记录可可靠取得的设备信息 |
| H9 | 组长日报可被点评 | 统一日报待办/页面/接口权限，作者的直属上级可点评 |
| P3-1 | 数据看板 | 出勤率/提交率/待审批/异常趋势统一视图 |
| P3-2 | 操作审计 | 9 类事件，按人/时间/事件查询，仅管理员 |
| P3-3 | 公告 + 已读回执 | 按部门发布，记实际收件人与首次阅读时间 |
| P3-4 | 员工档案 / 合同到期 | 合同起止/附件/到期提醒，仅 HR/管理员 |
| 桌面 | 打卡 IP 兜底 | 桌面无 GPS 时公网 IP 城市级坐标，凭证校验、不判围栏 |

**注意**:这批功能的**浏览器端四类角色验收、真实摄像头/定位、外部 IM 联调尚未做**(见 `docs/PC端开发计划1120.md` 发布门槛),代码和测试已就绪,但没在隔离测试环境走完端到端验收。

---

## 八、还没做的（截至 2026-11-20）

| 编号 | 功能 | 为什么重要 | 现状 |
|---|---|---|---|
| P0-3 | 生产发布流程 | 现在靠 Docker 镜像部署，固定版本产物与一键回滚脚本有交付但仍需在测试环境演练 | 待演练 |
| P0-4 | 数据备份 | 每日 `mongodump` + 保留 7 天 + 恢复演练脚本已有，未做恢复演练 | 待演练 |
| P1-1 | 个人考勤规则 | 计划只在确认后追加，取用顺序个人 > 部门 > 公司 | 待确认 |
| P3-5 | 移动端适配 | 打卡是主战场 | 未做 |
| P3-6 | HTTPS | 非 HTTPS 下浏览器禁用拍照与定位；测试环境 TLS 配置待目标域名确认 | 未做 |
| — | 四类角色端到端验收 | 本轮新功能的浏览器/真实设备/IM 联调 | 待做 |

---

## 九、已知限制（容易被问到的点）

1. **规则是公司级 + 部门级两级**，不是"个人 > 部门 > 全局"三级；个人规则本轮未纳入。
2. **今天的异常要等 18:00 之后才扫**，之前扫的是昨天及更早。
3. **通知已有独立页面** `#/announcements`，公告也在这里读；站内个人通知仍在工作台显示未读数。
4. **IM 推送是可选能力**：不配 `OA_IM_PUSH_URL` 就只有站内信，接口会返回 `pushed=false`，这不是 bug。
5. **打卡点默认不预设**：不配 `XINBO_OA_OFFICE_*` 时只记录坐标不判范围，页面上不会出现任何硬编码的公司名/地址。
6. **xlsx 和 CSV 都有**：`?format=xlsx` 出真 xlsx，`?format=csv` 出带 BOM 的 CSV，两者与页面同源；xlsx 用标准库手写 OOXML，没引第三方 Excel 库。
7. **请假不写打卡表**：月历上显示"请假"，但不产生打卡记录——这是刻意的，请假日不是"打了卡"。
8. **账号密码归 IM 管**：OA 管理后台只给已注册的 IM 账号建档，不能自己造账号或改密码；要新增账号先去 OpenIM 后台 `11002` 注册。
9. **测试密码是共用的**：六个账号统一 `Xinbo@2026`，仅用于开发/演示，上线前必须逐个改掉。
