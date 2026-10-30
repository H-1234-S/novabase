'use client';

import { useRealtimeSubscriptions } from '../hooks/use-realtime-subscriptions';
import { RealtimeStatusBar } from './realtime-status-bar';
import { RealtimeTableList } from './realtime-table-list';
import { RealtimeSnapshotList } from './realtime-snapshot-list';
import { RealtimeEventFeed } from './realtime-event-feed';

export function RealtimeClient({
  orgSlug,
  projectSlug,
  projectId,
  anonKey,
  tables,
}: {
  orgSlug: string;
  projectSlug: string;
  projectId: string;
  anonKey: string;
  tables: string[];
}) {
  const {
    connected,
    events,
    subscribedTables,
    pendingTables,
    subscriptionErrors,
    tableSnapshots,
    snapshotSyncing,
    snapshotSyncedAt,
    snapshotErrors,
    snapshotNotices,
    toggleTable,
    syncTableSnapshot,
    clearEvents,
  } = useRealtimeSubscriptions({ orgSlug, projectSlug, anonKey });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-medium">Realtime</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Subscribe to table changes and see them broadcast live
        </p>
      </div>

      <RealtimeStatusBar connected={connected} projectId={projectId} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-1">
          <h2 className="text-sm font-medium">Tables</h2>
          <RealtimeTableList
            tables={tables}
            subscribedTables={subscribedTables}
            pendingTables={pendingTables}
            subscriptionErrors={subscriptionErrors}
            connected={connected}
            onToggle={(table, enabled) => void toggleTable(table, enabled)}
          />
        </div>

        <div className="space-y-3 lg:col-span-2">
          <RealtimeSnapshotList
            subscribedTables={subscribedTables}
            tableSnapshots={tableSnapshots}
            snapshotSyncing={snapshotSyncing}
            snapshotSyncedAt={snapshotSyncedAt}
            snapshotErrors={snapshotErrors}
            snapshotNotices={snapshotNotices}
            onRefresh={(table) => void syncTableSnapshot(table)}
          />

          <RealtimeEventFeed
            events={events}
            hasSubscriptions={subscribedTables.size > 0}
            onClear={clearEvents}
          />
        </div>
      </div>
    </div>
  );
}
