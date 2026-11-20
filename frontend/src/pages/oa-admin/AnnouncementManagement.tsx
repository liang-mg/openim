import {
  App,
  Button,
  Collapse,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useEffect, useState } from "react";

import {
  getAnnouncementReceipts,
  getPublishedAnnouncements,
  publishAnnouncement,
  type Announcement,
  type AnnouncementReceipts,
  type AnnouncementRecipient,
  type AnnouncementSummary,
  type Department,
} from "@/api/oaApi";

import { departmentLabels } from "./DepartmentManagement";
import styles from "./index.module.scss";

interface FormValues {
  title: string;
  content: string;
  scope: Announcement["scope"];
  department_id?: string;
}

const displayTime = (value: number) => dayjs(value).format("YYYY-MM-DD HH:mm");

const receiptColumns: ColumnsType<AnnouncementRecipient> = [
  { title: "员工", dataIndex: "name" },
  {
    title: "状态",
    render: (_, row) =>
      row.read_at ? <Tag color="green">已读</Tag> : <Tag color="gold">未读</Tag>,
  },
  {
    title: "首次阅读时间",
    render: (_, row) => (row.read_at ? displayTime(row.read_at) : "—"),
  },
];

function AnnouncementsPanel({ departments }: { departments: Department[] }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const scope = Form.useWatch("scope", form);
  const [list, setList] = useState<AnnouncementSummary[]>([]);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [receipt, setReceipt] = useState<AnnouncementReceipts>();
  const [reading, setReading] = useState<string>();

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getPublishedAnnouncements()
      .then(({ list }) => {
        if (active) setList(list);
      })
      .catch((error: unknown) => {
        if (active)
          message.error(error instanceof Error ? error.message : "公告加载失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [message, version]);

  const publish = async (values: FormValues) => {
    setPublishing(true);
    try {
      const result = await publishAnnouncement({
        ...values,
        department_id: values.scope === "department" ? values.department_id : undefined,
      });
      if (result.notification_failures > 0) {
        message.warning(
          `公告已发布，站内通知送达 ${result.notified}/${result.recipient_count} 人`,
        );
      } else {
        message.success(`公告已发布，已通知 ${result.notified} 人`);
      }
      form.resetFields();
      setVersion((current) => current + 1);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "公告发布失败");
    } finally {
      setPublishing(false);
    }
  };

  const viewReceipts = async (id: string) => {
    setReading(id);
    try {
      setReceipt(await getAnnouncementReceipts(id));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "回执加载失败");
    } finally {
      setReading(undefined);
    }
  };

  const labels = departmentLabels(departments);
  const columns: ColumnsType<AnnouncementSummary> = [
    { title: "标题", dataIndex: "title" },
    {
      title: "范围",
      render: (_, item) => (item.scope === "company" ? "全公司" : item.department_name),
    },
    { title: "发布时间", render: (_, item) => displayTime(item.published_at) },
    {
      title: "已读人数",
      render: (_, item) => `${item.read_count} / ${item.recipient_count}`,
    },
    {
      title: "操作",
      render: (_, item) => (
        <Button
          type="link"
          disabled={Boolean(reading)}
          loading={reading === item.announcement_id}
          onClick={() => void viewReceipts(item.announcement_id)}
        >
          查看回执
        </Button>
      ),
    },
  ];

  return (
    <>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ scope: "company" }}
        onFinish={publish}
      >
        <Form.Item
          name="title"
          label="公告标题"
          rules={[{ required: true, whitespace: true }]}
        >
          <Input maxLength={120} showCount />
        </Form.Item>
        <Form.Item
          name="content"
          label="公告正文"
          rules={[{ required: true, whitespace: true }]}
        >
          <Input.TextArea
            maxLength={6000}
            showCount
            autoSize={{ minRows: 3, maxRows: 8 }}
          />
        </Form.Item>
        <Form.Item name="scope" label="发布范围">
          <Select
            options={[
              { value: "company", label: "全公司" },
              { value: "department", label: "指定部门" },
            ]}
          />
        </Form.Item>
        {scope === "department" && (
          <Form.Item
            name="department_id"
            label="选择部门"
            rules={[{ required: true, message: "请选择部门" }]}
            preserve={false}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={departments.map((department) => ({
                value: department.department_id,
                label: labels.get(department.department_id) ?? department.name,
              }))}
            />
          </Form.Item>
        )}
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={publishing}>
              发布公告
            </Button>
            <Button onClick={() => setVersion((current) => current + 1)}>
              刷新记录
            </Button>
          </Space>
        </Form.Item>
      </Form>
      <Table
        columns={columns}
        dataSource={list}
        loading={loading}
        rowKey="announcement_id"
        size="small"
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        locale={{ emptyText: "暂无已发布公告" }}
      />
      <Modal
        open={Boolean(receipt)}
        title={receipt?.title}
        onCancel={() => setReceipt(undefined)}
        footer={null}
      >
        {receipt && (
          <>
            <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {receipt.content}
            </p>
            <p>
              已读 {receipt.read_count} 人，未读{" "}
              {receipt.recipient_count - receipt.read_count} 人
            </p>
            <Table
              columns={receiptColumns}
              dataSource={receipt.recipients}
              rowKey="user_id"
              size="small"
              pagination={{ pageSize: 10, hideOnSinglePage: true }}
            />
          </>
        )}
      </Modal>
    </>
  );
}

export function AnnouncementManagement({ departments }: { departments: Department[] }) {
  return (
    <Collapse
      className={styles["rule-card"]}
      items={[
        {
          key: "announcements",
          label: "公告与阅读回执",
          children: <AnnouncementsPanel departments={departments} />,
        },
      ]}
    />
  );
}
