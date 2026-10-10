import { retrieveOAuthSettingsFromApi } from '@/features/project-auth/project-auth-helpers.server';
import { ProjectAuthProviders } from '@/features/project-auth/components/project-auth-providers';

export default async function AuthProvidersPage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string }>;
}) {
  const { slug, projectSlug } = await params;
  const settings = await retrieveOAuthSettingsFromApi(slug, projectSlug);

  return (
    <ProjectAuthProviders
      orgSlug={slug}
      projectSlug={projectSlug}
      initialSettings={settings}
    />
  );
}
