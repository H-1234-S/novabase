import { redirect } from 'next/navigation';
import apiClient from '@/lib/axios';
import { retrieveTokenFromCookie } from '@/server-utils/utils';
import { COOKIE_KEYS } from '@novabase/constants';
import type { StorageBucket, StorageObject } from '@novabase/types';

export async function retrieveBucketsFromApi(
  orgSlug: string,
  projectSlug: string,
): Promise<StorageBucket[]> {
  const token = await retrieveTokenFromCookie();

  try {
    const { data } = await apiClient.get<StorageBucket[]>(
      `/orgs/${orgSlug}/projects/${projectSlug}/storage/buckets`,
      { headers: { Cookie: `${COOKIE_KEYS.ACCESS_TOKEN}=${token}` } },
    );
    return data;
  } catch {
    redirect(`/organizations/${orgSlug}/projects`);
  }
}

export async function retrieveObjectsFromApi(
  orgSlug: string,
  projectSlug: string,
  bucketId: string,
): Promise<StorageObject[]> {
  const token = await retrieveTokenFromCookie();

  // 桶刚建好或还没对象时上游可能报错，这里兜底成空列表，
  // 不要因为列对象失败就把整个页面打挂
  try {
    const { data } = await apiClient.get<StorageObject[]>(
      `/orgs/${orgSlug}/projects/${projectSlug}/storage/buckets/${bucketId}/objects`,
      { headers: { Cookie: `${COOKIE_KEYS.ACCESS_TOKEN}=${token}` } },
    );
    return data;
  } catch {
    return [];
  }
}
