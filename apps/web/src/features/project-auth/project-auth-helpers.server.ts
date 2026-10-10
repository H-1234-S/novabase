import { redirect } from 'next/navigation';
import apiClient from '@/lib/axios';
import { retrieveTokenFromCookie } from '@/server-utils/utils';
import { COOKIE_KEYS } from '@novabase/constants';
import type { ProjectAuthUser, ProjectOAuthSettings } from '@novabase/types';

export async function retrieveProjectAuthUsersFromApi(
  orgSlug: string,
  projectSlug: string,
): Promise<ProjectAuthUser[]> {
  const token = await retrieveTokenFromCookie();

  try {
    const { data } = await apiClient.get<ProjectAuthUser[]>(
      `/orgs/${orgSlug}/projects/${projectSlug}/auth/users`,
      { headers: { Cookie: `${COOKIE_KEYS.ACCESS_TOKEN}=${token}` } },
    );
    return data;
  } catch {
    redirect(`/organizations/${orgSlug}/projects`);
  }
}

export async function retrieveOAuthSettingsFromApi(
  orgSlug: string,
  projectSlug: string,
): Promise<ProjectOAuthSettings> {
  const token = await retrieveTokenFromCookie();

  try {
    const { data } = await apiClient.get<ProjectOAuthSettings>(
      `/orgs/${orgSlug}/projects/${projectSlug}/auth/settings`,
      { headers: { Cookie: `${COOKIE_KEYS.ACCESS_TOKEN}=${token}` } },
    );
    return data;
  } catch {
    redirect(`/organizations/${orgSlug}/projects`);
  }
}
