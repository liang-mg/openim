import {
  ArrowLeftOutlined,
  PlusOutlined,
  SearchOutlined,
  StopOutlined,
  UndoOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { App as AntdApp, Button, Empty, Form, Input, InputNumber, Modal, Select, Spin, Switch, TimePicker } from "antd";
import clsx from "clsx";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  getAttendanceRule,
  getEmployeeList,
  getIMUserCandidates,
  getMe,
  saveAttendanceRule,
  saveEmployee,
  setEmployeeDisabled,
  type AttendanceRule,
  type EmployeeView,
  type IMUserOption,
  type OaIdentity,
  type OaRole,
} from "@/api/oaApi";
import { useUserStore } from "@/store";

import styles from "./index.module.scss";

const ROLE_META: Record<string, { text: string; cls: string; hint: string }> = {
  employee: { text: "员工", cls: "role-employee", hint: "只能看自己的日报" },
  manager: { text: "组长", cls: "role-manager", hint: "看组员 · 点评 · 上报" },
  leader: { text: "领导", cls: "role-leader", hint: "看本团队 · 点评 · 归档" },
};

const ROLE_OPTIONS = [
  { value: "employee", label: "员工", hint: "只能看自己的日报" },
  { value: "manager", label: "组长", hint: "看组员、点评、上报" },
  { value: "leader", label: "领导", hint: "看本团队、点评、归档" },
];

interface FormValues {
  user_id: string;
  real_name: string;
  department: string;
  position?: string;
  role: OaRole;
  manager_id?: string;
  is_admin?: boolean;
}

export const OaAdmin = () => {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const selfInfo = useUserStore((state) => state.selfInfo);
  const [form] = Form.useForm<FormValues>();

  const [me, setMe] = useState<OaIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<EmployeeView[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [keyword, setKeyword] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>();
  const [roleFilter, setRoleFilter] = useState<string>();
  const [includeDisabled, setIncludeDisabled] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeView | null>(null);
  const [saving, setSaving] = useState(false);
  const [imUsers, setImUsers] = useState<IMUserOption[]>([]);
  const [imLoading, setImLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getEmployeeList({
        keyword: keyword.trim() || undefined,
        department: deptFilter,
        role: roleFilter,
        includeDisabled,
      });
      setList(res.list || []);
      setDepartments(res.departments || []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [keyword, deptFilter, roleFilter, includeDisabled, message]);

  useEffect(() => {
    (async () => {
      try {
        const identity = await getMe();
        setMe(identity);
      } catch {
        message.error("加载身份失败");
      }
    })();
  }, [message]);

  useEffect(() => {
    if (me) load();
  }, [me, load]);

  // 可作为上级的人：组长、领导；编辑时排除自己
  const managerOptions = useMemo(() => {
    return list
      .filter((e) => !e.disabled && (e.role === "manager" || e.role === "leader"))
      .filter((e) => !editing || e.user_id !== editing.user_id)
      .map((e) => ({
        value: e.user_id,
        label: `${e.real_name}（${ROLE_META[e.role]?.text || e.role}${e.department ? " · " + e.department : ""}）`,
      }));
  }, [list, editing]);

  const openAdd = async () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ role: "employee", is_admin: false });
    setModalOpen(true);
    setImLoading(true);
    try {
      const users = await getIMUserCandidates();
      setImUsers(users || []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "读取 IM 账号失败");
    } finally {
      setImLoading(false);
    }
  };

  const openEdit = async (record: EmployeeView) => {
    setEditing(record);
    form.setFieldsValue({
      user_id: record.user_id,
      real_name: record.real_name,
      department: record.department,
      position: record.position,
      role: record.role,
      manager_id: record.manager_id || undefined,
      is_admin: !!record.is_admin,
    });
    setModalOpen(true);
    // 编辑时也要候选列表，用于切换上级（这里只需要 managerOptions，但保持一致加载）
    setImLoading(true);
    try {
      const users = await getIMUserCandidates();
      setImUsers(users || []);
    } catch {
      // 编辑场景候选不是必需，忽略
    } finally {
      setImLoading(false);
    }
  };

  const submit = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      await saveEmployee({
        user_id: values.user_id,
        real_name: values.real_name.trim(),
        department: values.department.trim(),
        position: (values.position || "").trim(),
        role: values.role,
        manager_id: values.manager_id || "",
        is_admin: !!values.is_admin,
      });
      message.success(editing ? "已保存" : "已添加，该成员现在可以打卡写日报了");
      setModalOpen(false);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const toggleDisabled = async (record: EmployeeView) => {
    const next = !record.disabled;
    const verb = next ? "停用" : "启用";
    Modal.confirm({
      title: `${verb}${record.real_name}？`,
      content: next
        ? "停用后该成员看不到 OA 入口、不再参与汇报链；历史日报与点评全部保留，可随时重新启用。"
        : "启用后该成员恢复打卡与写日报的能力，并重新计入上级的查阅范围。",
      okText: verb,
      cancelText: "取消",
      onOk: async () => {
        try {
          await setEmployeeDisabled(record.user_id, next);
          message.success(`已${verb}`);
          await load();
        } catch (e) {
          message.error(e instanceof Error ? e.message : `${verb}失败`);
        }
      },
    });
  };

  const canManage = !!me?.is_admin;

  // ---------- 考勤规则（管理员可改，改完即时生效） ----------
  const [rule, setRule] = useState<AttendanceRule | null>(null);
  const [ruleSaving, setRuleSaving] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    let alive = true;
    void getAttendanceRule()
      .then((r) => { if (alive) setRule(r); })
      .catch(() => {});
    return () => { alive = false; };
  }, [canManage]);

  const doSaveRule = useCallback(async () => {
    if (!rule) return;
    setRuleSaving(true);
    try {
      const saved = await saveAttendanceRule({
        work_on_time: rule.work_on_time,
        work_off_time: rule.work_off_time,
        late_grace: rule.late_grace,
        earliest_on: rule.earliest_on,
        need_photo: rule.need_photo,
        need_location: rule.need_location,
        makeup_max_days: rule.makeup_max_days,
        makeup_max_month: rule.makeup_max_month,
      });
      setRule(saved);
      message.success("考勤规则已保存，之后的打卡按新规则判定");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setRuleSaving(false);
    }
  }, [rule, message]);

  return (
    <div className={styles["admin-page"]}>
      <div className={styles["admin-topbar"]}>
        <div className={styles["topbar-left"]}>
          <ArrowLeftOutlined onClick={() => navigate("/work")} />
          <span>员工与权限</span>
          {canManage && <span className={styles.badge}>管理员</span>}
        </div>
        <span className={styles["topbar-user"]}>{selfInfo.nickname || me?.real_name || "同事"}</span>
      </div>

      <Spin spinning={loading}>
        <div className={styles["admin-body"]}>
          {!canManage ? (
            <div className={styles.empty}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="仅管理员可以维护员工与权限"
              />
            </div>
          ) : (
            <>
              <div className={styles["page-head"]}>
                <div>
                  <div className={styles["page-title"]}>员工与权限</div>
                  <div className={styles["page-desc"]}>
                    设置角色与直属上级，决定谁能看到谁的日报
                  </div>
                </div>
                <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
                  添加员工
                </Button>
              </div>

              <div className={styles["rule-card"]}>
                <div className={styles["rule-head"]}>
                  <div>
                    <div className={styles["rule-title"]}>考勤规则</div>
                    <div className={styles["rule-desc"]}>
                      {rule?.source === "env"
                        ? "当前在用默认配置（09:05 上班 / 18:00 下班），保存后以这里为准"
                        : "保存后立即生效；已产生的打卡记录判定不回溯，历史报表数字不变"}
                    </div>
                  </div>
                  <Button size="small" type="primary" loading={ruleSaving} onClick={() => void doSaveRule()}>
                    保存规则
                  </Button>
                </div>
                {rule && (
                  <div className={styles["rule-grid"]}>
                    <label>
                      <span>上班时间</span>
                      <TimePicker
                        size="small"
                        format="HH:mm"
                        minuteStep={5}
                        allowClear={false}
                        value={dayjs(rule.work_on_time, "HH:mm")}
                        onChange={(v) => v && setRule({ ...rule, work_on_time: v.format("HH:mm") })}
                      />
                    </label>
                    <label>
                      <span>下班时间</span>
                      <TimePicker
                        size="small"
                        format="HH:mm"
                        minuteStep={5}
                        allowClear={false}
                        value={dayjs(rule.work_off_time, "HH:mm")}
                        onChange={(v) => v && setRule({ ...rule, work_off_time: v.format("HH:mm") })}
                      />
                    </label>
                    <label>
                      <span>最早上班卡</span>
                      <TimePicker
                        size="small"
                        format="HH:mm"
                        minuteStep={5}
                        allowClear={false}
                        value={dayjs(rule.earliest_on, "HH:mm")}
                        onChange={(v) => v && setRule({ ...rule, earliest_on: v.format("HH:mm") })}
                      />
                    </label>
                    <label>
                      <span>迟到宽限（分钟）</span>
                      <InputNumber
                        size="small" min={0} max={120} value={rule.late_grace}
                        onChange={(v) => setRule({ ...rule, late_grace: Number(v ?? 0) })}
                      />
                    </label>
                    <label>
                      <span>可补最近几天</span>
                      <InputNumber
                        size="small" min={0} max={90} value={rule.makeup_max_days}
                        onChange={(v) => setRule({ ...rule, makeup_max_days: Number(v ?? 0) })}
                      />
                    </label>
                    <label>
                      <span>每月补卡上限</span>
                      <InputNumber
                        size="small" min={0} max={99} value={rule.makeup_max_month}
                        onChange={(v) => setRule({ ...rule, makeup_max_month: Number(v ?? 0) })}
                      />
                    </label>
                    <label className={styles["rule-switch"]}>
                      <span>打卡需要照片</span>
                      <Switch
                        size="small" checked={rule.need_photo}
                        onChange={(v) => setRule({ ...rule, need_photo: v })}
                      />
                    </label>
                    <label className={styles["rule-switch"]}>
                      <span>打卡需要定位</span>
                      <Switch
                        size="small" checked={rule.need_location}
                        onChange={(v) => setRule({ ...rule, need_location: v })}
                      />
                    </label>
                  </div>
                )}
              </div>

              <div className={styles.toolbar}>
                <Input
                  allowClear
                  prefix={<SearchOutlined />}
                  placeholder="搜索姓名、部门或岗位"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  className={styles.search}
                />
                <Select
                  allowClear
                  placeholder="部门：全部"
                  className={styles.filter}
                  value={deptFilter}
                  onChange={setDeptFilter}
                  options={departments.map((d) => ({ value: d, label: d }))}
                />
                <Select
                  allowClear
                  placeholder="角色：全部"
                  className={styles.filter}
                  value={roleFilter}
                  onChange={setRoleFilter}
                  options={ROLE_OPTIONS.map((r) => ({ value: r.value, label: r.label }))}
                />
                <div className={styles["disabled-toggle"]}>
                  <Switch size="small" checked={includeDisabled} onChange={setIncludeDisabled} />
                  <span>含已停用</span>
                </div>
              </div>

              <div className={styles["table-card"]}>
                <div className={styles["table-head"]}>
                  <span>成员</span>
                  <span>部门</span>
                  <span>岗位</span>
                  <span>角色</span>
                  <span>直属上级</span>
                  <span className={styles["col-actions"]}>操作</span>
                </div>

                {list.length === 0 ? (
                  <div className={styles.empty}>
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={keyword || deptFilter || roleFilter ? "没有匹配的成员" : "还没有成员，先添加一个"}
                    />
                  </div>
                ) : (
                  list.map((e) => {
                    const roleMeta = ROLE_META[e.role] || { text: e.role, cls: "", hint: "" };
                    const managerName =
                      list.find((x) => x.user_id === e.manager_id)?.real_name || e.manager_id || "—";
                    return (
                      <div
                        key={e.user_id}
                        className={clsx(styles["table-row"], { [styles.disabled]: e.disabled })}
                      >
                        <div className={styles.member}>
                          <div className={styles.avatar}>
                            {e.real_name ? e.real_name.slice(0, 1) : <UserOutlined />}
                          </div>
                          <div className={styles["member-info"]}>
                            <div className={styles["member-name"]}>
                              {e.real_name}
                              {e.is_admin && <span className={styles["admin-tag"]}>管理员</span>}
                              {e.disabled && <span className={styles["disabled-tag"]}>已停用</span>}
                            </div>
                            <div className={styles["member-phone"]}>{e.phone_number || e.user_id}</div>
                          </div>
                        </div>
                        <span className={styles.cell}>{e.department}</span>
                        <span className={styles.cell}>{e.position || "—"}</span>
                        <span className={styles["cell-role"]}>
                          <span className={clsx(styles["role-tag"], styles[roleMeta.cls])}>
                            {roleMeta.text}
                          </span>
                        </span>
                        <span className={styles.cell}>{managerName}</span>
                        <span className={styles["col-actions"]}>
                          <button className={styles["link-btn"]} onClick={() => openEdit(e)}>
                            编辑
                          </button>
                          <button
                            className={clsx(styles["link-btn"], styles["danger-btn"])}
                            onClick={() => toggleDisabled(e)}
                          >
                            {e.disabled ? (
                              <>
                                <UndoOutlined /> 启用
                              </>
                            ) : (
                              <>
                                <StopOutlined /> 停用
                              </>
                            )}
                          </button>
                        </span>
                      </div>
                    );
                  })
                )}
              </div>

              <div className={styles.tip}>
                角色决定可见范围：员工只看自己；组长看直属组员；领导看下属及其下属（本团队）。勾选管理员可维护本页，
                管理员与业务角色相互独立，领导可以兼任。
              </div>
            </>
          )}
        </div>
      </Spin>

      <Modal
        title={editing ? "编辑员工" : "添加员工"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={520}
        destroyOnClose
      >
        <Form form={form} layout="vertical" className={styles.form} requiredMark={false}>
          <Form.Item
            label="IM 账号"
            name="user_id"
            rules={[{ required: true, message: "请选择 IM 账号" }]}
            extra={editing ? undefined : "只能从已注册的 IM 账号里选，昵称会自动带入"}
          >
            {editing ? (
              <Input disabled />
            ) : (
              <Select
                showSearch
                loading={imLoading}
                placeholder={imLoading ? "正在读取账号…" : "搜索昵称或手机号"}
                optionFilterProp="label"
                onChange={(uid: string) => {
                  const picked = imUsers.find((u) => u.user_id === uid);
                  if (picked) form.setFieldsValue({ real_name: picked.nickname || "" });
                }}
                options={imUsers.map((u) => ({
                  value: u.user_id,
                  label: `${u.nickname || u.user_id} ${u.phone_number || ""}${u.has_profile ? "（已有档案）" : ""}`,
                  disabled: u.has_profile,
                }))}
              />
            )}
          </Form.Item>

          <div className={styles["form-row"]}>
            <Form.Item
              label="姓名"
              name="real_name"
              rules={[{ required: true, message: "请填姓名" }]}
              className={styles["form-col"]}
            >
              <Input placeholder="如：李然" maxLength={20} />
            </Form.Item>
            <Form.Item
              label="部门"
              name="department"
              rules={[{ required: true, message: "请填部门" }]}
              className={styles["form-col"]}
            >
              <Input placeholder="如：技术部" maxLength={20} list="oa-dept-list" />
            </Form.Item>
          </div>

          <Form.Item label="岗位" name="position">
            <Input placeholder="如：前端工程师（可不填）" maxLength={30} />
          </Form.Item>

          <Form.Item
            label="角色"
            name="role"
            rules={[{ required: true, message: "请选择角色" }]}
          >
            <Select
              options={ROLE_OPTIONS.map((r) => ({
                value: r.value,
                label: `${r.label} · ${r.hint}`,
              }))}
            />
          </Form.Item>

          <Form.Item
            label="直属上级"
            name="manager_id"
            extra="选领导即为顶层；留空也是顶层（例如公司负责人）"
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="选择上级"
              options={managerOptions}
            />
          </Form.Item>

          <Form.Item
            label="管理员"
            name="is_admin"
            valuePropName="checked"
            extra="勾选后可维护本页的人员与权限；与业务角色互不影响"
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <datalist id="oa-dept-list">
        {departments.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
    </div>
  );
};

export default OaAdmin;
