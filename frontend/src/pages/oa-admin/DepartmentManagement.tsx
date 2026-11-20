import { PlusOutlined } from "@ant-design/icons";
import { App as AntdApp, Button, Form, Input, Modal, Select } from "antd";
import { useState } from "react";

import {
  getEmployeeList,
  migrateDepartment,
  saveDepartment,
  type Department,
  type DepartmentList,
  type EmployeeView,
} from "@/api/oaApi";

import styles from "./index.module.scss";

interface DepartmentForm {
  name: string;
  parent_id?: string;
  head_id?: string;
}

export function departmentLabels(departments: Department[]): Map<string, string> {
  const names = new Map(departments.map((department) => [department.department_id, department.name]));
  return new Map(departments.map((department) => [
    department.department_id,
    [names.get(department.parent_id), department.name].filter(Boolean).join(" / "),
  ]));
}

export function DepartmentManagement({ data, onChanged }: {
  data: DepartmentList;
  onChanged: () => Promise<void>;
}) {
  const { message, modal } = AntdApp.useApp();
  const [form] = Form.useForm<DepartmentForm>();
  const [editing, setEditing] = useState<Department | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [members, setMembers] = useState<EmployeeView[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [legacyName, setLegacyName] = useState<string>();
  const [targetId, setTargetId] = useState<string>();
  const roots = data.list.filter((department) => !department.parent_id);
  const labels = departmentLabels(data.list);

  const openEditor = async (department?: Department) => {
    setEditing(department ?? null);
    form.resetFields();
    if (department) {
      form.setFieldsValue({
        name: department.name,
        parent_id: department.parent_id || undefined,
        head_id: department.head_id || undefined,
      });
    }
    setOpen(true);
    setLoadingMembers(true);
    try {
      setMembers((await getEmployeeList({ includeDisabled: true })).list);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "读取部门负责人候选失败");
    } finally {
      setLoadingMembers(false);
    }
  };

  const save = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    setSaving(true);
    try {
      await saveDepartment({ ...values, department_id: editing?.department_id });
      message.success(editing ? "部门负责人已保存" : "部门已创建");
      setOpen(false);
      await onChanged();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存部门失败");
    } finally {
      setSaving(false);
    }
  };

  const confirmMigration = () => {
    if (!legacyName || !targetId) return;
    const count = data.unlinked.find((item) => item.name === legacyName)?.count ?? 0;
    modal.confirm({
      title: "确认部门对应关系",
      content: `将旧部门「${legacyName}」下的 ${count} 名未关联员工，批量关联到「${labels.get(targetId)}」。`,
      okText: "确认关联",
      cancelText: "取消",
      onOk: async () => {
        try {
          const result = await migrateDepartment(legacyName, targetId);
          message.success(`已关联 ${result.linked} 名员工`);
          setLegacyName(undefined);
          setTargetId(undefined);
          await onChanged();
        } catch (e) {
          message.error(e instanceof Error ? e.message : "关联旧部门失败");
          throw e;
        }
      },
    });
  };

  const renderDepartment = (department: Department) => (
    <div className={styles["department-row"]}>
      <span>{department.name}</span>
      <Button type="link" size="small" onClick={() => void openEditor(department)}>
        {department.head_id ? "更换负责人" : "设置负责人"}
      </Button>
    </div>
  );

  return (
    <section className={styles["rule-card"]} aria-label="部门管理">
      <div className={styles["rule-head"]}>
        <div className={styles["rule-title"]}>部门管理</div>
        <Button size="small" icon={<PlusOutlined />} onClick={() => void openEditor()}>
          新建部门
        </Button>
      </div>

      {roots.length === 0 ? (
        <p className={styles["rule-desc"]}>暂无部门</p>
      ) : (
        <ul className={styles["department-tree"]}>
          {roots.map((root) => {
            const children = data.list.filter((department) => department.parent_id === root.department_id);
            return (
              <li key={root.department_id}>
                {renderDepartment(root)}
                {children.length > 0 && (
                  <ul>
                    {children.map((department) => (
                      <li key={department.department_id}>{renderDepartment(department)}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {data.unlinked.length > 0 && data.list.length > 0 && (
        <div className={styles["department-migration"]}>
          <div className={styles["rule-title"]}>关联旧部门</div>
          <div className={styles["department-controls"]}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              aria-label="旧部门名称"
              placeholder="选择旧部门名称"
              value={legacyName}
              onChange={setLegacyName}
              options={data.unlinked.map((item) => ({
                value: item.name,
                label: `${item.name}（${item.count} 人）`,
              }))}
            />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              aria-label="新部门"
              placeholder="选择对应的新部门"
              value={targetId}
              onChange={setTargetId}
              options={data.list.map((item) => ({
                value: item.department_id,
                label: labels.get(item.department_id),
              }))}
            />
            <Button disabled={!legacyName || !targetId} onClick={confirmMigration}>批量关联</Button>
          </div>
        </div>
      )}

      <Modal
        title={editing ? `设置「${editing.name}」负责人` : "新建部门"}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        okButtonProps={{ disabled: loadingMembers }}
      >
        <Form form={form} layout="vertical">
          {!editing && (
            <>
              <Form.Item name="name" label="部门名称" rules={[{ required: true, whitespace: true }]}>
                <Input maxLength={60} />
              </Form.Item>
              <Form.Item name="parent_id" label="上级部门">
                <Select
                  allowClear
                  placeholder="留空创建一级部门"
                  options={roots.map((root) => ({ value: root.department_id, label: root.name }))}
                />
              </Form.Item>
            </>
          )}
          <Form.Item name="head_id" label="部门负责人" extra="员工没有可用的直属上级时，由部门负责人审批新申请">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              loading={loadingMembers}
              placeholder="选择在岗员工"
              options={members
                .filter((member) => !member.disabled || member.user_id === editing?.head_id)
                .map((member) => ({
                  value: member.user_id,
                  label: `${member.real_name} · ${member.department}${member.disabled ? "（已停用）" : ""}`,
                  disabled: member.disabled,
                }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}
