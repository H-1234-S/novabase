'use client';

import { Radio, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { RealtimeEvent } from '@novabase/types';

const EVENT_COLORS: Record<string, string> = {
  INSERT: 'bg-green-100 text-green-700',
  UPDATE: 'bg-yellow-100 text-yellow-700',
  DELETE: 'bg-red-100 text-red-700',
};

export function RealtimeEventFeed({
  events,
  hasSubscriptions,
  onClear,
}: {
  events: (RealtimeEvent & { id: string })[];
  hasSubscriptions: boolean;
  onClear: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">
          Event Feed
          {events.length > 0 && (
            <span className="ml-2 font-normal text-muted-foreground">
              ({events.length})
            </span>
          )}
        </h2>
        {events.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={onClear}
          >
            <Trash2 size={12} />
            Clear
          </Button>
        )}
      </div>

      {!hasSubscriptions ? (
        <EmptyState
          icon={<Radio size={24} className="mb-3 text-muted-foreground" />}
          title="Toggle a table to start listening"
          hint="Events will appear here in real time"
        />
      ) : events.length === 0 ? (
        <EmptyState
          icon={<BouncingDots />}
          title="Listening for changes..."
          hint="Insert, update, or delete a row to see an event"
        />
      ) : (
        <ScrollArea className="h-[500px] rounded-xl border border-border">
          <div className="divide-y divide-border">
            {events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        </ScrollArea>
      )}
    </>
  );
}

function EventRow({ event }: { event: RealtimeEvent }) {
  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex items-center gap-2">
        <Badge
          variant="secondary"
          className={cn(
            'font-mono text-xs font-bold',
            EVENT_COLORS[event.type],
          )}
        >
          {event.type}
        </Badge>
        <span className="font-mono text-sm text-muted-foreground">
          {event.table}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {new Date(event.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {event.record && (
        <pre className="overflow-x-auto rounded-lg bg-muted p-2 font-mono text-xs">
          {JSON.stringify(event.record, null, 2)}
        </pre>
      )}

      {event.oldRecord && (
        <pre className="overflow-x-auto rounded-lg bg-muted/50 p-2 font-mono text-xs text-muted-foreground">
          {JSON.stringify(event.oldRecord, null, 2)}
        </pre>
      )}

      {!event.record && (
        <p className="text-xs text-muted-foreground">
          Change notification only; row contents are not broadcast.
        </p>
      )}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
      {icon}
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function BouncingDots() {
  return (
    <div className="mb-3 flex gap-1">
      {[0, 150, 300].map((delay) => (
        <div
          key={delay}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}
