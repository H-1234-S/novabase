import { redirect } from 'next/navigation';
import apiClient from '@/lib/axios';
import { retrieveTokenFromCookie } from '@/server-utils/utils';
import { COOKIE_KEYS } from '@novabase/constants';
import type { Project } from '@novabase/types';

export async function retrieveTablesFromApi(
  orgSlug: string,
  projectSlug: string,
): Promise<string[]> {
  const token = await retrieveTokenFromCookie();

  try {
    const { data } = await apiClient.get<string[]>(
      `/orgs/${orgSlug}/projects/${projectSlug}/tables`,
      { headers: { Cookie: `${COOKIE_KEYS.ACCESS_TOKEN}=${token}` } },
    );
    return data;
  } catch {
    redirect(`/organizations/${orgSlug}/projects`);
  }
}

export async function retrieveProjectDbSchema(
  orgSlug: string,
  projectSlug: string,
): Promise<string> {
  const token = await retrieveTokenFromCookie();

  try {
    const { data } = await apiClient.get<{ projects: Project }>(
      `/orgs/${orgSlug}/projects/${projectSlug}`,
      { headers: { Cookie: `${COOKIE_KEYS.ACCESS_TOKEN}=${token}` } },
    );
    return data.projects.dbSchema;
  } catch {
    redirect(`/organizations/${orgSlug}/projects`);
  }
}
