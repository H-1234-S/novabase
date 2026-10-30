import { retrieveApiDocsFromApi } from '@/features/api-docs/api-docs-helpers.server';
import { ApiDocsClient } from '@/features/api-docs/api-docs-client';

export default async function ApiDocsPage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string }>;
}) {
  const { slug, projectSlug } = await params;
  const docs = await retrieveApiDocsFromApi(slug, projectSlug);

  return (
    <div className="h-full min-h-0 overflow-y-auto p-6">
      <ApiDocsClient docs={docs} />
    </div>
  );
}
