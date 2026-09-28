'use server';

import { revalidatePath } from 'next/cache';
import { projectsServerSchema } from './server.schema';
import { PROJECTS_INTENT } from './constants';
import { COOKIE_KEYS } from '@novabase/constants';
import { retrieveTokenFromCookie } from '@/server-utils/utils';
import apiClient from '@/lib/axios';

export type ProjectsActionState = {
  error?: string;
  success?: string;
};

export async function projectsAction(
  { slug }: { slug: string },
  _prev: ProjectsActionState,
  formData: FormData,
): Promise<ProjectsActionState> {
  const raw = Object.fromEntries(formData);
  const parsed = projectsServerSchema.safeParse(raw);

  if (!parsed.success) {
    return { error: parsed.error.flatten().formErrors[0] ?? 'Invalid input' };
  }

  const token = await retrieveTokenFromCookie();
  const { intent, ...data } = parsed.data;

  try {
    switch (intent) {
      case PROJECTS_INTENT.CREATE: {
        await apiClient.post(
          `/orgs/${slug}/projects`,
          { name: (data as { name: string }).name },
          { headers: { Cookie: `${COOKIE_KEYS.ACCESS_TOKEN}=${token}` } },
        );
        revalidatePath(`/organizations/${slug}/projects`);
        return { success: 'Project created!' };
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return { error: err.response?.data?.message ?? 'Something went wrong' };
  }
}
