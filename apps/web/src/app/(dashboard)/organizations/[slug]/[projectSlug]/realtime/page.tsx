import {
  retrieveProjectForRealtime,
  retrieveTablesForRealtime,
} from '@/features/realtime/realtime-helpers.server';
import { RealtimeClient } from '@/features/realtime/components/realtime-client';

export default async function RealtimePage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string }>;
}) {
  const { slug, projectSlug } = await params;

  const [project, tables] = await Promise.all([
    retrieveProjectForRealtime(slug, projectSlug),
    retrieveTablesForRealtime(slug, projectSlug),
  ]);

  return (
    <div className="h-full min-h-0 overflow-y-auto p-6">
      <RealtimeClient
        orgSlug={slug}
        projectSlug={projectSlug}
        projectId={project.id}
        anonKey={project.anonKey}
        tables={tables}
      />
    </div>
  );
}
