'use client';

import { Radio } from 'lucide-react';
import { cn } from '@/lib/utils';

export function RealtimeStatusBar({
  connected,
  projectId,
}: {
  connected: boolean;
  projectId: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          'h-2 w-2 rounded-full',
          connected ? 'bg-green-500' : 'bg-red-500',
        )}
      />
      <span className="text-sm text-muted-foreground">
        {connected ? 'Connected' : 'Disconnected'}
      </span>
      <Radio
        size={14}
        className={cn(
          'ml-1',
          connected ? 'text-green-500' : 'text-muted-foreground',
        )}
      />
      <span className="ml-2 font-mono text-xs text-muted-foreground">
        project:{projectId}
      </span>
    </div>
  );
}
