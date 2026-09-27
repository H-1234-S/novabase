'use server';

import { COOKIE_KEYS } from '@novabase/constants';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export async function signOut() {
  await fetch(`${process.env.API_URL}/auth/logout`, {
    method: 'POST',
  });

  const cookieStore = await cookies();
  cookieStore.delete(`${COOKIE_KEYS.ACCESS_TOKEN}`);
  cookieStore.delete(`${COOKIE_KEYS.REFRESH_TOKEN}`);

  redirect('/login');
}
