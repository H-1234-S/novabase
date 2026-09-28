import { redirect } from 'next/navigation';
import apiClient from '@/lib/axios';
import { retrieveTokenFromCookie } from '@/server-utils/utils';
import { COOKIE_KEYS } from '@novabase/constants';
import type { Project } from '@novabase/types';

export async function retrieveProjectsFromApi(
  orgSlug: string,
): Promise<Project[]> {
  const token = await retrieveTokenFromCookie();

  try {
    const { data } = await apiClient.get<Project[]>(
      `/orgs/${orgSlug}/projects`,
      { headers: { Cookie: `${COOKIE_KEYS.ACCESS_TOKEN}=${token}` } },
    );
    return data;
  } catch {
    redirect('/organizations');
  }
}

export async function retrieveProjectBySlugFromApi(
  orgSlug: string,
  projectSlug: string,
): Promise<Project> {
  const token = await retrieveTokenFromCookie();

  try {
    const { data } = await apiClient.get<Project>(
      `/orgs/${orgSlug}/projects/${projectSlug}`,
      { headers: { Cookie: `${COOKIE_KEYS.ACCESS_TOKEN}=${token}` } },
    );
    return data;
  } catch {
    redirect(`/organizations/${orgSlug}/projects`);
  }
}
