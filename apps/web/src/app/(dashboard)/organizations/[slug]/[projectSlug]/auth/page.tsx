import { redirect } from 'next/navigation';

export default async function AuthIndexPage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string }>;
}) {
  const { slug, projectSlug } = await params;
  redirect(`/organizations/${slug}/${projectSlug}/auth/users`);
}
