<script lang="ts" setup>
import { onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Button,
  Card,
  Form,
  Input,
  message,
  Modal,
  Space,
  Table,
  Tag,
  Tooltip,
  Upload,
} from 'ant-design-vue';

import {
  deleteCosmicResourceApi,
  getCosmicResourceListApi,
  type CosmicApi,
  uploadCosmicResourceApi,
} from '#/api/core/cosmic';

const loading = ref(false);
const uploadLoading = ref(false);
const uploadModalVisible = ref(false);
const resources = ref<CosmicApi.ResourceItem[]>([]);

const uploadForm = ref<{
  file: File | null;
  description: string;
}>({
  file: null,
  description: '',
});

async function fetchList() {
  loading.value = true;
  try {
    const res = await getCosmicResourceListApi();
    resources.value = res.items ?? [];
  } catch {
    message.error('获取资源列表失败');
  } finally {
    loading.value = false;
  }
}

function handleFileChange(file: File) {
  uploadForm.value.file = file;
  return false;
}

async function handleUpload() {
  if (!uploadForm.value.file) {
    message.warning('请选择 Excel 文件');
    return;
  }

  uploadLoading.value = true;
  try {
    const formData = new FormData();
    formData.append('file', uploadForm.value.file);
    if (uploadForm.value.description) {
      formData.append('description', uploadForm.value.description);
    }

    await uploadCosmicResourceApi(formData);
    message.success('上传成功');
    uploadModalVisible.value = false;
    uploadForm.value = { file: null, description: '' };
    await fetchList();
  } catch {
    message.error('上传失败');
  } finally {
    uploadLoading.value = false;
  }
}

async function handleDelete(record: CosmicApi.ResourceItem) {
  Modal.confirm({
    content: `确定删除资源「${record.real_file_name}」吗？`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        await deleteCosmicResourceApi(record.id);
        message.success('删除成功');
        await fetchList();
      } catch {
        message.error('删除失败');
      }
    },
  });
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const columns = [
  { dataIndex: 'id', key: 'id', title: 'ID', width: 60 },
  {
    dataIndex: 'real_file_name',
    key: 'real_file_name',
    title: '文件名',
    width: 240,
    ellipsis: true,
  },
  {
    dataIndex: 'file_name',
    key: 'file_name',
    title: '存储文件名',
    width: 280,
    ellipsis: true,
  },
  { dataIndex: 'description', key: 'description', title: '描述', width: 200 },
  {
    dataIndex: 'file_size',
    key: 'file_size',
    title: '大小',
    width: 100,
  },
  { dataIndex: 'created_at', key: 'created_at', title: '上传时间', width: 180 },
  { key: 'action', title: '操作', width: 100 },
];

onMounted(() => {
  fetchList();
});
</script>

<template>
  <Page description="管理 COSMIC 评估的 Excel 资源文件" title="文档管理">
    <Card class="mb-5">
      <div class="flex items-center justify-between">
        <Space>
          <span class="text-sm text-gray-500">共 {{ resources.length }} 个资源</span>
        </Space>
        <Button type="primary" @click="uploadModalVisible = true">
          上传文件
        </Button>
      </div>
    </Card>

    <Card>
      <Table
        :columns="columns"
        :data-source="resources"
        :loading="loading"
        :pagination="{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (total: number) => `共 ${total} 条`,
        }"
        bordered
        row-key="id"
        size="middle"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'file_name'">
            <Tooltip :title="record.file_name">
              <span class="truncate block max-w-[260px]">{{ record.file_name }}</span>
            </Tooltip>
          </template>
          <template v-if="column.key === 'file_size'">
            <Tag color="blue">{{ formatFileSize(record.file_size) }}</Tag>
          </template>
          <template v-if="column.key === 'action'">
            <Button danger size="small" @click="handleDelete(record)">
              删除
            </Button>
          </template>
        </template>
      </Table>
    </Card>

    <Modal
      v-model:visible="uploadModalVisible"
      :confirm-loading="uploadLoading"
      cancel-text="取消"
      ok-text="上传"
      title="上传 Excel 文件"
      @ok="handleUpload"
    >
      <Form layout="vertical">
        <Form.Item label="Excel 文件" required>
          <Upload
            :before-upload="handleFileChange"
            :show-upload-list="true"
            accept=".xlsx,.xls"
          >
            <Button>选择文件</Button>
          </Upload>
        </Form.Item>
        <Form.Item label="描述">
          <Input.TextArea
            v-model:value="uploadForm.description"
            placeholder="资源描述（可选）"
            :rows="3"
          />
        </Form.Item>
      </Form>
    </Modal>
  </Page>
</template>