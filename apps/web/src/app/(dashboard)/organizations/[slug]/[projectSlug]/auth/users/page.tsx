import { retrieveProjectAuthUsersFromApi } from '@/features/project-auth/project-auth-helpers.server';
import { ProjectAuthUsers } from '@/features/project-auth/components/project-auth-users';

export default async function AuthUsersPage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string }>;
}) {
  const { slug, projectSlug } = await params;
  const users = await retrieveProjectAuthUsersFromApi(slug, projectSlug);

  return <ProjectAuthUsers users={users} />;
}
