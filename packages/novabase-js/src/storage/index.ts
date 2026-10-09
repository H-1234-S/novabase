import { genUploader } from 'uploadthing/client';
import type { StorageObject } from '@novabase/types';

export interface StorageResult<T> {
  data: T | null;
  error: string | null;
}

// 通用请求处理逻辑
async function apiFetch<T>(
  url: string,
  apiKey: string,
  init?: RequestInit,
): Promise<StorageResult<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { message?: string };
      return { data: null, error: err.message ?? `HTTP ${res.status}` };
    }

    const data = (await res.json()) as T;
    return { data, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error';
    return { data: null, error: message };
  }
}

export class StorageBucketRef {
  constructor(
    private projectUrl: string,
    private apiKey: string,
    private bucketName: string,
  ) {}

  private storageBase(): string {
    // 对 bucketName 转换处理
    const bucket = encodeURIComponent(this.bucketName);
    return `${this.projectUrl}/storage/buckets/${bucket}`;
  }

  // 获得所有文件列表
  async list(): Promise<StorageResult<StorageObject[]>> {
    return apiFetch<StorageObject[]>(
      `${this.storageBase()}/objects`,
      this.apiKey,
    );
  }

  // 上传文件 hook
  async upload(file: File): Promise<StorageResult<StorageObject>> {
    try {
      // TODO:THINK
      // 先打到 后端校验 再上传到 Uploadthing remote
      const uploadUrl = `${this.storageBase()}/upload`;
      const { uploadFiles } = genUploader({
        url: uploadUrl,
      });

      const uploaded = await uploadFiles('bucketUploader', {
        files: [file],
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      const utFile = uploaded[0];
      if (!utFile) {
        return { data: null, error: 'Upload returned no files' };
      }

      // 注册元数据
      return apiFetch<StorageObject>(
        `${this.storageBase()}/objects`,
        this.apiKey,
        {
          method: 'POST',
          body: JSON.stringify({
            name: utFile.name,
            size: utFile.size,
            type: file.type || 'application/octet-stream',
            utKey: utFile.key,
            url: utFile.ufsUrl,
          }),
        },
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      return { data: null, error: message };
    }
  }

  async remove(objectId: string): Promise<StorageResult<{ message: string }>> {
    return apiFetch<{ message: string }>(
      `${this.projectUrl}/storage/objects/${objectId}`,
      this.apiKey,
      { method: 'DELETE' },
    );
  }

  // 获得临时访问的 URL
  async getSignedUrl(
    objectId: string,
  ): Promise<StorageResult<{ url: string }>> {
    return apiFetch<{ url: string }>(
      `${this.projectUrl}/storage/objects/${objectId}/signed-url`,
      this.apiKey,
    );
  }
}

export class NovabaseStorage {
  constructor(
    private projectUrl: string,
    private apiKey: string,
  ) {}

  from(bucketName: string): StorageBucketRef {
    return new StorageBucketRef(this.projectUrl, this.apiKey, bucketName);
  }
}
