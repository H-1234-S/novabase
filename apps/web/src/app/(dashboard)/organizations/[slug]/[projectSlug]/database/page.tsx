import { TableEditorClient } from '@/features/table-editor/components/table-editor-client';
import {
  retrieveTablesFromApi,
  retrieveProjectDbSchema,
} from '@/features/table-editor/table-editor-helpers.server';

export default async function DatabasePage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string }>;
}) {
  const { slug, projectSlug } = await params;

  const [tables, dbSchema] = await Promise.all([
    retrieveTablesFromApi(slug, projectSlug),
    retrieveProjectDbSchema(slug, projectSlug),
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <TableEditorClient
        orgSlug={slug}
        projectSlug={projectSlug}
        dbSchema={dbSchema}
        initialTables={tables}
      />
    </div>
  );
}
