import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_KEYS } from '@novabase/constants';

export async function retrieveTokenFromCookie(): Promise<string> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_KEYS.ACCESS_TOKEN)?.value;
  if (!token) redirect('/login');
  return token;
}
