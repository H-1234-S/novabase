'use server';

import { revalidatePath } from 'next/cache';
import { COOKIE_KEYS } from '@novabase/constants';
import apiClient from '@/lib/axios';
import { retrieveTokenFromCookie } from '@/server-utils/utils';
import { PROJECT_AUTH_INTENT } from './data/project-auth-constants';
import { projectAuthServerSchema } from './schemas/project-auth-server.schema';

export type ProjectAuthActionState = {
  error?: string;
  success?: string;
};

export async function projectAuthAction(
  {
    orgSlug,
    projectSlug,
  }: {
    orgSlug: string;
    projectSlug: string;
  },
  _prev: ProjectAuthActionState,
  formData: FormData,
): Promise<ProjectAuthActionState> {
  const raw = Object.fromEntries(formData);
  const parsed = projectAuthServerSchema.safeParse(raw);

  if (!parsed.success) {
    return { error: parsed.error.flatten().formErrors[0] ?? 'Invalid input' };
  }

  const token = await retrieveTokenFromCookie();
  const { intent, ...data } = parsed.data;

  try {
    switch (intent) {
      case PROJECT_AUTH_INTENT.SAVE_GOOGLE: {
        await apiClient.post(
          `/orgs/${orgSlug}/projects/${projectSlug}/auth/settings`,
          data,
          { headers: { Cookie: `${COOKIE_KEYS.ACCESS_TOKEN}=${token}` } },
        );
        revalidatePath(
          `/organizations/${orgSlug}/${projectSlug}/auth/providers`,
        );
        return { success: 'Google settings saved' };
      }

      case PROJECT_AUTH_INTENT.SAVE_GITHUB: {
        await apiClient.post(
          `/orgs/${orgSlug}/projects/${projectSlug}/auth/settings`,
          data,
          { headers: { Cookie: `${COOKIE_KEYS.ACCESS_TOKEN}=${token}` } },
        );
        revalidatePath(
          `/organizations/${orgSlug}/${projectSlug}/auth/providers`,
        );
        return { success: 'GitHub settings saved' };
      }

      case PROJECT_AUTH_INTENT.SAVE_SITE_URL: {
        await apiClient.post(
          `/orgs/${orgSlug}/projects/${projectSlug}/auth/settings`,
          data,
          { headers: { Cookie: `${COOKIE_KEYS.ACCESS_TOKEN}=${token}` } },
        );
        revalidatePath(
          `/organizations/${orgSlug}/${projectSlug}/auth/url-configuration`,
        );
        return { success: 'Site URL saved' };
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return { error: err.response?.data?.message ?? 'Something went wrong' };
  }
}
