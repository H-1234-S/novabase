'use client';

import { Table2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

export function RealtimeTableList({
  tables,
  subscribedTables,
  pendingTables,
  subscriptionErrors,
  connected,
  onToggle,
}: {
  tables: string[];
  subscribedTables: Set<string>;
  pendingTables: Set<string>;
  subscriptionErrors: Map<string, string>;
  connected: boolean;
  onToggle: (tableName: string, enabled: boolean) => void;
}) {
  if (tables.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No tables yet — create one in the Table Editor
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {tables.map((table) => {
        const subscribed = subscribedTables.has(table);
        const pending = pendingTables.has(table);

        return (
          <div
            key={table}
            className="flex items-center justify-between rounded-xl border border-border p-3"
          >
            <div className="flex items-center gap-2">
              <Table2 size={14} className="text-muted-foreground" />
              <span className="font-mono text-sm">{table}</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'text-xs font-medium',
                  subscribed ? 'text-green-600' : 'text-muted-foreground',
                )}
              >
                {pending ? 'Connecting…' : subscribed ? 'Listening' : 'Off'}
              </span>
              <Switch
                checked={subscribed}
                onCheckedChange={(checked) => onToggle(table, checked)}
                disabled={!connected || pending}
                className="cursor-pointer"
              />
            </div>
            {subscriptionErrors.has(table) && (
              <p className="mt-2 text-xs text-red-600">
                {subscriptionErrors.get(table)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
