import { retrieveSqlHistoryFromApi } from '@/features/sql-editor/sql-editor-helpers.server';
import { SqlEditorClient } from '@/features/sql-editor/sql-editor-client';

export default async function SqlEditorPage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string }>;
}) {
  const { slug, projectSlug } = await params;
  const history = await retrieveSqlHistoryFromApi(slug, projectSlug);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <SqlEditorClient
        orgSlug={slug}
        projectSlug={projectSlug}
        initialHistory={history}
      />
    </div>
  );
}
