import { retrieveOAuthSettingsFromApi } from '@/features/project-auth/project-auth-helpers.server';
import { ProjectAuthUrlConfig } from '@/features/project-auth/components/project-auth-url-config';
import { getProjectApiBase } from '@/lib/server-api';

export default async function AuthUrlConfigurationPage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string }>;
}) {
  const { slug, projectSlug } = await params;
  const settings = await retrieveOAuthSettingsFromApi(slug, projectSlug);
  const fallbackSiteUrl =
    process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3001';

  return (
    <ProjectAuthUrlConfig
      orgSlug={slug}
      projectSlug={projectSlug}
      initialSiteUrl={settings.siteUrl ?? fallbackSiteUrl}
      projectApiBase={getProjectApiBase(projectSlug)}
    />
  );
}
