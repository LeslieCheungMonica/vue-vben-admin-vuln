import { baseRequestClient } from '#/api/request';

// baseRequestClient 返回的 AxiosResponse 结构
interface ApiResponse<T> {
  data: T;
}

export namespace ResourceApi {
  export interface ResourceItem {
    id: number;
    code: string;
    version: string;
    description: string;
    extracted_path: string;
  }

  export interface ResourceListResult {
    status: string;
    items: ResourceItem[];
    message: string;
  }

  export interface ResourceUploadResult {
    status: string;
    extracted_path: string;
    message: string;
  }

  export interface ResourceDeleteResult {
    status: string;
    message: string;
  }
}

export async function getResourceListApi(code?: string, version?: string) {
  const params: Record<string, string> = {};
  if (code) params.code = code;
  if (version) params.version = version;
  const { data } = await baseRequestClient.post<
    ApiResponse<ResourceApi.ResourceListResult>
  >('/wape/resource_list', params);
  return data;
}

export async function uploadResourceApi(formData: FormData) {
  const { data } = await baseRequestClient.post<
    ApiResponse<ResourceApi.ResourceUploadResult>
  >('/wape/resource_upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function deleteResourceApi(id: number) {
  const { data } = await baseRequestClient.post<
    ApiResponse<ResourceApi.ResourceDeleteResult>
  >('/wape/resource_delete', { id });
  return data;
}
