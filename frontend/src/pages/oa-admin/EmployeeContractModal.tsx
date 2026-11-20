import { UploadOutlined } from "@ant-design/icons";
import { App as AntdApp, Button, DatePicker, Form, Modal, Space, Spin, Tag, Upload, type UploadFile } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useState } from "react";

import {
  downloadContractAttachment,
  getEmployeeContract,
  saveEmployeeContract,
  uploadFile,
  type ContractAttachment,
  type EmployeeContract,
} from "@/api/oaApi";

const CONTRACT_STATUS: Record<EmployeeContract["status"], { text: string; color: string }> = {
  upcoming: { text: "待生效", color: "blue" },
  active: { text: "有效", color: "green" },
  expiring: { text: "30 天内到期", color: "orange" },
  expired: { text: "已到期", color: "red" },
};

const MAX_ATTACHMENTS = 5;

export function EmployeeContractModal({ employeeId, employeeName, onClose }: {
  employeeId: string;
  employeeName: string;
  onClose: () => void;
}) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<{ range: [Dayjs, Dayjs] }>();
  const [contract, setContract] = useState<EmployeeContract | null>(null);
  const [attachments, setAttachments] = useState<ContractAttachment[]>([]);
  const [uploads, setUploads] = useState<UploadFile<ContractAttachment>[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void getEmployeeContract(employeeId).then((record) => {
      if (!alive || !record) return;
      setContract(record);
      setAttachments(record.attachments || []);
      form.setFieldsValue({ range: [dayjs(record.start_date), dayjs(record.end_date)] });
    }).catch((e: unknown) => {
      if (alive) {
        setFailed(true);
        message.error(e instanceof Error ? e.message : "读取合同失败");
      }
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [employeeId, form, message]);

  const save = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    setSaving(true);
    try {
      const ids = attachments.map((attachment) => attachment.file_id);
      for (const file of uploads) {
        let attachment = file.response;
        if (!attachment) {
          if (!file.originFileObj) throw new Error("请重新选择附件");
          const uploaded = await uploadFile(file.originFileObj, "contract", employeeId);
          setUploads((files) => files.map((item) =>
            item.uid === file.uid ? { ...item, status: "done", response: uploaded } : item,
          ));
          attachment = uploaded;
        }
        ids.push(attachment.file_id);
      }
      await saveEmployeeContract({
        employee_id: employeeId,
        start_date: values.range[0].format("YYYY-MM-DD"),
        end_date: values.range[1].format("YYYY-MM-DD"),
        updated_at: contract?.updated_at ?? 0,
        attachment_ids: ids,
      });
      message.success("员工合同已保存");
      onClose();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存合同失败");
    } finally {
      setSaving(false);
    }
  };

  const download = async (attachment: ContractAttachment) => {
    try {
      const blob = await downloadContractAttachment(employeeId, attachment.file_id);
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = attachment.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch {
      message.error("合同附件下载失败");
    }
  };

  const remaining = MAX_ATTACHMENTS - attachments.length;
  const status = contract && CONTRACT_STATUS[contract.status];
  return (
    <Modal
      title={`${employeeName}的合同`}
      open
      onCancel={() => { if (!saving) onClose(); }}
      onOk={() => void save()}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      okButtonProps={{ disabled: loading || failed }}
      cancelButtonProps={{ disabled: saving }}
    >
      <Spin spinning={loading}>
        <Form form={form} layout="vertical" disabled={loading || failed || saving}>
          <Form.Item label="状态">
            <Tag color={status?.color}>{status?.text || (failed ? "读取失败" : "暂无合同")}</Tag>
          </Form.Item>
          <Form.Item name="range" label="合同起止日期" rules={[{ required: true, message: "请选择合同起止日期" }]}>
            <DatePicker.RangePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label={`合同附件（选填，最多 ${MAX_ATTACHMENTS} 个）`}>
            <Space direction="vertical" size={4}>
              {attachments.map((attachment) => (
                <Space key={attachment.file_id}>
                  <Button type="link" onClick={() => void download(attachment)}>{attachment.name}</Button>
                  <Button size="small" type="text" onClick={() => setAttachments((files) =>
                    files.filter((file) => file.file_id !== attachment.file_id),
                  )}>移除</Button>
                </Space>
              ))}
              <Upload<ContractAttachment>
                fileList={uploads}
                onChange={({ fileList }) => setUploads(fileList)}
                beforeUpload={() => false}
                multiple
                maxCount={remaining}
                showUploadList={{ showRemoveIcon: !saving }}
              >
                <Button icon={<UploadOutlined />} disabled={saving || uploads.length >= remaining}>
                  选择文件
                </Button>
              </Upload>
            </Space>
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  );
}
