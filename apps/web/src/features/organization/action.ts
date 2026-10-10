'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { COOKIE_KEYS } from '@novabase/constants';
import apiClient from '@/lib/axios';
import { retrieveTokenFromCookie } from '@/server-utils/utils';
import { organizationServerSchema } from './server.schema';

export type OrganizationActionState = {
  error?: string;
};

export async function organizationAction(
  _prev: OrganizationActionState,
  formData: FormData,
): Promise<OrganizationActionState> {
  const raw = Object.fromEntries(formData);
  const parsed = organizationServerSchema.safeParse(raw);

  if (!parsed.success) {
    return { error: parsed.error.flatten().formErrors[0] ?? 'Invalid input' };
  }

  const token = await retrieveTokenFromCookie();

  let slug: string;

  try {
    const { data } = await apiClient.post<{ slug: string }>(
      '/orgs',
      { name: parsed.data.name },
      { headers: { Cookie: `${COOKIE_KEYS.ACCESS_TOKEN}=${token}` } },
    );

    slug = data.slug;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return { error: err.response?.data?.message ?? 'Something went wrong' };
  }

  revalidatePath('/organizations');
  redirect(`/organizations/${slug}/projects`);
}
