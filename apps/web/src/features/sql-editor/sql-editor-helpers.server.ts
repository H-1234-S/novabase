import { redirect } from 'next/navigation';
import apiClient from '@/lib/axios';
import { retrieveTokenFromCookie } from '@/server-utils/utils';
import { COOKIE_KEYS } from '@novabase/constants';
import type { QueryHistoryItem } from '@novabase/types';

export async function retrieveSqlHistoryFromApi(
  orgSlug: string,
  projectSlug: string,
): Promise<QueryHistoryItem[]> {
  const token = await retrieveTokenFromCookie();

  try {
    const { data } = await apiClient.get<QueryHistoryItem[]>(
      `/orgs/${orgSlug}/projects/${projectSlug}/sql/history`,
      { headers: { Cookie: `${COOKIE_KEYS.ACCESS_TOKEN}=${token}` } },
    );
    return data;
  } catch {
    redirect(`/organizations/${orgSlug}/projects`);
  }
}
