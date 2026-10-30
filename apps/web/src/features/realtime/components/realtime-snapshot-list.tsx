'use client';

import { Button } from '@/components/ui/button';

export function RealtimeSnapshotList({
  subscribedTables,
  tableSnapshots,
  snapshotSyncing,
  snapshotSyncedAt,
  snapshotErrors,
  snapshotNotices,
  onRefresh,
}: {
  subscribedTables: Set<string>;
  tableSnapshots: Map<string, unknown[]>;
  snapshotSyncing: Set<string>;
  snapshotSyncedAt: Map<string, Date>;
  snapshotErrors: Map<string, string>;
  snapshotNotices: Map<string, string>;
  onRefresh: (tableName: string) => void;
}) {
  if (subscribedTables.size === 0) return null;

  return (
    <section className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Current data snapshots</h2>
        <span className="text-xs text-muted-foreground">
          Refreshed after subscribe or listener recovery; up to 1,000 rows per
          table
        </span>
      </div>

      {[...subscribedTables].map((tableName) => {
        const rows = tableSnapshots.get(tableName);
        const syncedAt = snapshotSyncedAt.get(tableName);
        const syncing = snapshotSyncing.has(tableName);

        return (
          <div key={tableName} className="rounded-lg bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-xs">{tableName}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {syncing
                    ? 'Syncing current data…'
                    : syncedAt
                      ? `${rows?.length ?? 0} rows · ${syncedAt.toLocaleTimeString()}`
                      : 'No snapshot yet'}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={syncing}
                  onClick={() => onRefresh(tableName)}
                >
                  Refresh
                </Button>
              </div>
            </div>

            {snapshotErrors.has(tableName) && (
              <p className="mt-2 text-xs text-red-600">
                Snapshot sync failed: {snapshotErrors.get(tableName)}
              </p>
            )}

            {snapshotNotices.has(tableName) && (
              <p className="mt-2 text-xs text-amber-700">
                {snapshotNotices.get(tableName)}
              </p>
            )}

            {rows && rows.length > 0 && (
              <pre className="mt-2 max-h-48 overflow-auto rounded bg-background p-2 font-mono text-xs">
                {JSON.stringify(rows.slice(0, 10), null, 2)}
              </pre>
            )}

            {rows?.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                The table is empty.
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
