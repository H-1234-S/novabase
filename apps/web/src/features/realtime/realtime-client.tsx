'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Radio, Trash2, Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { REALTIME_EVENTS } from '@novabase/constants';
import type { RealtimeEvent } from '@novabase/types';

interface RealtimeClientProps {
  orgSlug: string;
  projectSlug: string;
  projectId: string;
  anonKey: string;
  tables: string[];
}

type SubscriptionAck =
  | {
      ok: true;
      cursor?: string;
      gap?: 'none' | 'replayed' | 'expired';
      replayed?: number;
    }
  | { ok: false; code: string; message: string };

function emitSubscription(
  socket: Socket,
  event: string,
  tableName: string,
  since?: string,
): Promise<SubscriptionAck> {
  return new Promise((resolve) => {
    const timeout = setTimeout(
      () =>
        resolve({
          ok: false,
          code: 'ACK_TIMEOUT',
          message: 'Realtime server did not respond',
        }),
      5000,
    );
    const payload =
      event === REALTIME_EVENTS.SUBSCRIBE
        ? { table: tableName, since }
        : tableName;
    socket.emit(event, payload, (response: SubscriptionAck) => {
      clearTimeout(timeout);
      resolve(
        response ?? {
          ok: false,
          code: 'INVALID_ACK',
          message: 'Invalid server response',
        },
      );
    });
  });
}

const EVENT_COLORS: Record<string, string> = {
  INSERT: 'bg-green-100 text-green-700',
  UPDATE: 'bg-yellow-100 text-yellow-700',
  DELETE: 'bg-red-100 text-red-700',
};

function getRealtimeSocketBaseUrl(): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api';
  // WebSocket namespace is NOT under /api
  return apiUrl.replace(/\/api\/?$/, '');
}

export function RealtimeClient({
  orgSlug,
  projectSlug,
  projectId,
  anonKey,
  tables,
}: RealtimeClientProps) {
  // 连接状态
  const [connected, setConnected] = useState(false);
  // 订阅表列表
  const [subscribedTables, setSubscribedTables] = useState<Set<string>>(
    new Set(),
  );
  const [pendingTables, setPendingTables] = useState<Set<string>>(new Set());
  const [subscriptionErrors, setSubscriptionErrors] = useState<
    Map<string, string>
  >(new Map());
  const [events, setEvents] = useState<(RealtimeEvent & { id: string })[]>([]);
  const [tableSnapshots, setTableSnapshots] = useState<Map<string, unknown[]>>(
    new Map(),
  );
  const [snapshotSyncing, setSnapshotSyncing] = useState<Set<string>>(
    new Set(),
  );
  const [snapshotSyncedAt, setSnapshotSyncedAt] = useState<Map<string, Date>>(
    new Map(),
  );
  const [snapshotErrors, setSnapshotErrors] = useState<Map<string, string>>(
    new Map(),
  );
  const [snapshotNotices, setSnapshotNotices] = useState<Map<string, string>>(
    new Map(),
  );
  // socket 实例
  const socketRef = useRef<Socket | null>(null);
  // 订阅表列表 ref
  const subscribedRef = useRef<Set<string>>(new Set());
  const cursorRef = useRef<Map<string, string>>(new Map());
  const snapshotRequestsRef = useRef<Map<string, AbortController>>(new Map());

  const syncTableSnapshot = useCallback(
    async (tableName: string) => {
      snapshotRequestsRef.current.get(tableName)?.abort();
      const controller = new AbortController();
      snapshotRequestsRef.current.set(tableName, controller);
      setSnapshotSyncing((prev) => new Set(prev).add(tableName));
      setSnapshotErrors((prev) => {
        const next = new Map(prev);
        next.delete(tableName);
        return next;
      });

      const apiUrl =
        process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api';
      const url = new URL(
        `${apiUrl.replace(/\/+$/, '')}/projects/${encodeURIComponent(projectSlug)}/rest/${encodeURIComponent(tableName)}`,
      );
      url.searchParams.set('limit', '1000');

      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${anonKey}` },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Snapshot request failed (${response.status})`);
        }
        const rows: unknown = await response.json();
        if (!Array.isArray(rows)) {
          throw new Error('Snapshot response was not a row list');
        }
        if (snapshotRequestsRef.current.get(tableName) !== controller) return;
        setTableSnapshots((prev) => new Map(prev).set(tableName, rows));
        setSnapshotSyncedAt((prev) => new Map(prev).set(tableName, new Date()));
      } catch (error) {
        if (controller.signal.aborted) return;
        setSnapshotErrors((prev) =>
          new Map(prev).set(
            tableName,
            error instanceof Error ? error.message : 'Snapshot sync failed',
          ),
        );
      } finally {
        if (snapshotRequestsRef.current.get(tableName) === controller) {
          snapshotRequestsRef.current.delete(tableName);
          setSnapshotSyncing((prev) => {
            const next = new Set(prev);
            next.delete(tableName);
            return next;
          });
        }
      }
    },
    [anonKey, projectSlug],
  );

  const updateCursor = useCallback((tableName: string, cursor: string) => {
    if (!/^[0-9]{1,20}$/.test(cursor)) return;
    const previous = cursorRef.current.get(tableName);
    if (!previous || BigInt(cursor) > BigInt(previous)) {
      cursorRef.current.set(tableName, cursor);
    }
  }, []);

  const handleSubscribeAck = useCallback(
    (tableName: string, ack: SubscriptionAck) => {
      if (!ack.ok) return false;
      if (ack.cursor) updateCursor(tableName, ack.cursor);
      if (ack.gap === 'expired') {
        setSnapshotNotices((prev) =>
          new Map(prev).set(
            tableName,
            'Replay window expired. Current data was refreshed; individual missed changes are unavailable.',
          ),
        );
        void syncTableSnapshot(tableName);
      } else if (ack.gap === 'replayed') {
        setSnapshotNotices((prev) => {
          const next = new Map(prev);
          next.delete(tableName);
          return next;
        });
        void syncTableSnapshot(tableName);
      } else {
        setSnapshotNotices((prev) => {
          const next = new Map(prev);
          next.delete(tableName);
          return next;
        });
      }
      return true;
    },
    [syncTableSnapshot, updateCursor],
  );

  useEffect(() => {
    subscribedRef.current = subscribedTables;
  }, [subscribedTables]);

  // 进入页面即鉴权
  useEffect(() => {
    const snapshotRequests = snapshotRequestsRef.current;
    // 建立 Socket 连接
    // 请求到达后端的 Gateway
    const socket = io(`${getRealtimeSocketBaseUrl()}/realtime`, {
      auth: { token: anonKey },
      // Socket.io 的两种传输方式
      // 优先 websocket，失败回退 polling
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      setConnected(true);
      // 重新连接后重新订阅
      for (const tableName of subscribedRef.current) {
        void emitSubscription(
          socket,
          REALTIME_EVENTS.SUBSCRIBE,
          tableName,
          cursorRef.current.get(tableName),
        ).then((ack) => {
          if (!ack.ok) {
            setSubscribedTables((prev) => {
              const next = new Set(prev);
              next.delete(tableName);
              subscribedRef.current = next;
              return next;
            });
            setSubscriptionErrors((prev) =>
              new Map(prev).set(tableName, ack.message),
            );
          } else {
            handleSubscribeAck(tableName, ack);
            if (ack.gap === 'none') void syncTableSnapshot(tableName);
          }
        });
      }
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on(
      REALTIME_EVENTS.ERROR,
      (
        msg: string | {
          code?: string;
          table?: string;
          message?: string;
          cursor?: string;
        },
      ) => {
        console.error('Realtime error:', msg);
        if (typeof msg === 'string') {
          setConnected(false);
        } else if (msg.table && msg.message) {
          setSubscriptionErrors((prev) => {
            const next = new Map(prev);
            if (msg.code === 'LISTENER_CONNECTED') next.delete(msg.table!);
            else next.set(msg.table!, msg.message!);
            return next;
          });
          if (
            msg.code === 'CURSOR_EXPIRED' ||
            msg.code === 'CURSOR_REPLAY_FAILED'
          ) {
            if (msg.cursor) updateCursor(msg.table, msg.cursor);
            setSnapshotNotices((prev) =>
              new Map(prev).set(
                msg.table!,
                msg.code === 'CURSOR_EXPIRED'
                  ? 'Replay window expired. Current data was refreshed; individual missed changes are unavailable.'
                  : 'Missed events could not be replayed. Current data was refreshed instead.',
              ),
            );
            void syncTableSnapshot(msg.table);
          } else if (
            msg.code === 'LISTENER_CONNECTED' &&
            subscribedRef.current.has(msg.table)
          ) {
            void syncTableSnapshot(msg.table);
          }
        }
      },
    );

    // 接收服务端传来的信息
    socket.on(REALTIME_EVENTS.EVENT, (event: RealtimeEvent) => {
      if (!/^[0-9]{1,20}$/.test(event.seq)) return;
      const cursor = cursorRef.current.get(event.table);
      if (cursor && BigInt(event.seq) <= BigInt(cursor)) return;
      updateCursor(event.table, event.seq);
      setEvents((prev) => [
        { ...event, id: crypto.randomUUID() },
        // 最多一百条
        ...prev.slice(0, 99),
      ]);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      snapshotRequests.forEach((controller) => controller.abort());
      snapshotRequests.clear();
    };
  }, [anonKey, handleSubscribeAck, syncTableSnapshot, updateCursor]);

  // Switch Call Function
  const toggleTable = useCallback(
    async (tableName: string, enabled: boolean) => {
      const socket = socketRef.current;
      if (!socket || pendingTables.has(tableName)) return;

      setPendingTables((prev) => new Set(prev).add(tableName));
      setSubscriptionErrors((prev) => {
        const next = new Map(prev);
        next.delete(tableName);
        return next;
      });

      const apiUrl =
        process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api';

      try {
        if (enabled) {
          const response = await fetch(
            `${apiUrl}/orgs/${orgSlug}/projects/${projectSlug}/realtime/${encodeURIComponent(tableName)}/enable`,
            { method: 'POST', credentials: 'include' },
          );
          if (!response.ok)
            throw new Error('Could not enable Realtime for this table');

          const ack = await emitSubscription(
            socket,
            REALTIME_EVENTS.SUBSCRIBE,
            tableName,
          );
          if (!ack.ok) throw new Error(ack.message);
          setSubscribedTables((prev) => new Set([...prev, tableName]));
          subscribedRef.current = new Set([...subscribedRef.current, tableName]);
          handleSubscribeAck(tableName, ack);
          if (ack.gap === 'none') await syncTableSnapshot(tableName);
        } else {
          const ack = await emitSubscription(
            socket,
            REALTIME_EVENTS.UNSUBSCRIBE,
            tableName,
          );
          if (!ack.ok) throw new Error(ack.message);
          setSubscribedTables((prev) => {
            const next = new Set(prev);
            next.delete(tableName);
            subscribedRef.current = next;
            return next;
          });
          snapshotRequestsRef.current.get(tableName)?.abort();
          snapshotRequestsRef.current.delete(tableName);
          cursorRef.current.delete(tableName);
          setSnapshotSyncing((prev) => {
            const next = new Set(prev);
            next.delete(tableName);
            return next;
          });
          setTableSnapshots((prev) => {
            const next = new Map(prev);
            next.delete(tableName);
            return next;
          });
          setSnapshotSyncedAt((prev) => {
            const next = new Map(prev);
            next.delete(tableName);
            return next;
          });
          setSnapshotErrors((prev) => {
            const next = new Map(prev);
            next.delete(tableName);
            return next;
          });
          setSnapshotNotices((prev) => {
            const next = new Map(prev);
            next.delete(tableName);
            return next;
          });

          const response = await fetch(
            `${apiUrl}/orgs/${orgSlug}/projects/${projectSlug}/realtime/${encodeURIComponent(tableName)}/disable`,
            { method: 'DELETE', credentials: 'include' },
          );
          if (!response.ok) {
            throw new Error(
              'Stopped listening, but could not disable the database trigger',
            );
          }
        }
      } catch (error) {
        setSubscriptionErrors((prev) =>
          new Map(prev).set(
            tableName,
            error instanceof Error
              ? error.message
              : 'Realtime operation failed',
          ),
        );
      } finally {
        setPendingTables((prev) => {
          const next = new Set(prev);
          next.delete(tableName);
          return next;
        });
      }
    },
    [
      handleSubscribeAck,
      orgSlug,
      projectSlug,
      pendingTables,
      syncTableSnapshot,
    ],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-medium">Realtime</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Subscribe to table changes and see them broadcast live
        </p>
      </div>

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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-1">
          <h2 className="text-sm font-medium">Tables</h2>

          {tables.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No tables yet — create one in the Table Editor
            </p>
          ) : (
            <div className="space-y-2">
              {tables.map((table) => (
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
                        subscribedTables.has(table)
                          ? 'text-green-600'
                          : 'text-muted-foreground',
                      )}
                    >
                      {pendingTables.has(table)
                        ? 'Connecting…'
                        : subscribedTables.has(table)
                          ? 'Listening'
                          : 'Off'}
                    </span>
                    {/* BUG：Toggle button issue */}
                    <Switch
                      checked={subscribedTables.has(table)}
                      onCheckedChange={(checked) =>
                        void toggleTable(table, checked)
                      }
                      disabled={!connected || pendingTables.has(table)}
                      className="cursor-pointer"
                    />
                  </div>
                  {subscriptionErrors.has(table) && (
                    <p className="mt-2 text-xs text-red-600">
                      {subscriptionErrors.get(table)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3 lg:col-span-2">
          {subscribedTables.size > 0 && (
            <section className="space-y-3 rounded-xl border border-border p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">Current data snapshots</h2>
                <span className="text-xs text-muted-foreground">
                Refreshed after subscribe or listener recovery; up to 1,000 rows per table
                </span>
              </div>
              {[...subscribedTables].map((tableName) => {
                const rows = tableSnapshots.get(tableName);
                const syncedAt = snapshotSyncedAt.get(tableName);
                return (
                  <div key={tableName} className="rounded-lg bg-muted/40 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-xs">{tableName}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {snapshotSyncing.has(tableName)
                            ? 'Syncing current data…'
                            : syncedAt
                              ? `${rows?.length ?? 0} rows · ${syncedAt.toLocaleTimeString()}`
                              : 'No snapshot yet'}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={snapshotSyncing.has(tableName)}
                          onClick={() => void syncTableSnapshot(tableName)}
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
          )}

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
                onClick={() => setEvents([])}
              >
                <Trash2 size={12} />
                Clear
              </Button>
            )}
          </div>

          {subscribedTables.size === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
              <Radio size={24} className="mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Toggle a table to start listening
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Events will appear here in real time
              </p>
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
              <div className="mb-3 flex gap-1">
                <div
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground"
                  style={{ animationDelay: '0ms' }}
                />
                <div
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground"
                  style={{ animationDelay: '150ms' }}
                />
                <div
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground"
                  style={{ animationDelay: '300ms' }}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Listening for changes...
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Insert, update, or delete a row to see an event
              </p>
            </div>
          ) : (
            <ScrollArea className="h-[500px] rounded-xl border border-border">
              <div className="divide-y divide-border">
                {events.map((event) => (
                  <div key={event.id} className="space-y-2 px-4 py-3">
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
                        Change notification only; row contents are not
                        broadcast.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    </div>
  );
}
