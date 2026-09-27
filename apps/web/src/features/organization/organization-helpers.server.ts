import { redirect } from 'next/navigation';
import apiClient from '@/lib/axios';
import { retrieveTokenFromCookie } from '@/server-utils/utils';
import { COOKIE_KEYS } from '@novabase/constants';
import type { OrganizationWithMeta } from '@novabase/types';

// 获取组织信息
export async function retrieveMyOrganizationsFromApi(): Promise<
  OrganizationWithMeta[]
> {
  const token = await retrieveTokenFromCookie();

  try {
    const { data } = await apiClient.get<OrganizationWithMeta[]>('/orgs', {
      headers: {
        Cookie: `${COOKIE_KEYS.ACCESS_TOKEN}=${token}`,
      },
    });
    return data;
  } catch {
    redirect('/login');
  }
}

export async function retrieveOrganizationBySlugFromApi(slug: string) {
  const token = await retrieveTokenFromCookie();

  try {
    const { data } = await apiClient.get(`/orgs/${slug}`, {
      headers: { Cookie: `${COOKIE_KEYS.ACCESS_TOKEN}=${token}` },
    });
    return data;
  } catch {
    redirect('/organizations');
  }
}
