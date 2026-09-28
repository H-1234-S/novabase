import { redirect } from 'next/navigation';
import apiClient from '@/lib/axios';
import { retrieveTokenFromCookie } from '@/server-utils/utils';
import { COOKIE_KEYS } from '@novabase/constants';
import type { OrgMemberWithUser } from '@novabase/types';

export async function retrieveMembersFromApi(
  slug: string,
): Promise<OrgMemberWithUser[]> {
  const token = await retrieveTokenFromCookie();

  try {
    const { data } = await apiClient.get<OrgMemberWithUser[]>(
      `/orgs/${slug}/members`,
      { headers: { Cookie: `${COOKIE_KEYS.ACCESS_TOKEN}=${token}` } },
    );
    return data;
  } catch {
    redirect('/organizations');
  }
}
