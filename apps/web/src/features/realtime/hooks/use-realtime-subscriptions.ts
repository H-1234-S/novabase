'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { REALTIME_EVENTS } from '@novabase/constants';
import type { RealtimeEvent } from '@novabase/types';
import { env } from '@/lib/env';
import {
  createRealtimeSocket,
  emitSubscription,
  type SubscriptionAck,
} from '../api/realtime-socket';

/** 事件流最多保留的条数 */
const MAX_EVENTS = 100;
/** 单表快照一次拉取的行数上限 */
const SNAPSHOT_ROW_LIMIT = 1000;

export interface UseRealtimeSubscriptionsInput {
  orgSlug: string;
  projectSlug: string;
  anonKey: string;
}

/**
 * 实时订阅状态机。
 *
 * 负责连接生命周期、订阅/退订、游标（cursor）推进、快照同步与错误收集，
 * 视图层只需要消费返回的只读状态和动作。
 */
export function useRealtimeSubscriptions({
  orgSlug,
  projectSlug,
  anonKey,
}: UseRealtimeSubscriptionsInput) {
  const [connected, setConnected] = useState(false);
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

  const socketRef = useRef<Socket | null>(null);
  const subscribedRef = useRef<Set<string>>(new Set());
  const cursorRef = useRef<Map<string, string>>(new Map());
  const snapshotRequestsRef = useRef<Map<string, AbortController>>(new Map());

  /** 拉取单表当前数据快照；同一表并发请求以最后一次为准 */
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

      const url = new URL(
        `${env.apiUrl.replace(/\/+$/, '')}/projects/${encodeURIComponent(projectSlug)}/rest/${encodeURIComponent(tableName)}`,
      );
      url.searchParams.set('limit', String(SNAPSHOT_ROW_LIMIT));

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

  /** 游标只允许单调递增，防止乱序事件把游标推回去 */
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

  // 连接重建后需要知道当前订阅了哪些表，用 ref 镜像一份避免把 effect 依赖绑到 state
  useEffect(() => {
    subscribedRef.current = subscribedTables;
  }, [subscribedTables]);

  useEffect(() => {
    const snapshotRequests = snapshotRequestsRef.current;
    const socket = createRealtimeSocket(anonKey);

    socket.on('connect', () => {
      setConnected(true);
      // 重连后按游标重新订阅，服务端会补齐断线期间的事件
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
            return;
          }

          handleSubscribeAck(tableName, ack);
          if (ack.gap === 'none') void syncTableSnapshot(tableName);
        });
      }
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on(
      REALTIME_EVENTS.ERROR,
      (
        msg:
          | string
          | {
              code?: string;
              table?: string;
              message?: string;
              cursor?: string;
            },
      ) => {
        console.error('Realtime error:', msg);
        if (typeof msg === 'string') {
          setConnected(false);
          return;
        }
        if (!msg.table || !msg.message) return;

        const table = msg.table;
        setSubscriptionErrors((prev) => {
          const next = new Map(prev);
          if (msg.code === 'LISTENER_CONNECTED') next.delete(table);
          else next.set(table, msg.message as string);
          return next;
        });

        if (msg.code === 'CURSOR_EXPIRED' || msg.code === 'CURSOR_REPLAY_FAILED') {
          if (msg.cursor) updateCursor(table, msg.cursor);
          setSnapshotNotices((prev) =>
            new Map(prev).set(
              table,
              msg.code === 'CURSOR_EXPIRED'
                ? 'Replay window expired. Current data was refreshed; individual missed changes are unavailable.'
                : 'Missed events could not be replayed. Current data was refreshed instead.',
            ),
          );
          void syncTableSnapshot(table);
        } else if (
          msg.code === 'LISTENER_CONNECTED' &&
          subscribedRef.current.has(table)
        ) {
          void syncTableSnapshot(table);
        }
      },
    );

    socket.on(REALTIME_EVENTS.EVENT, (event: RealtimeEvent) => {
      if (!/^[0-9]{1,20}$/.test(event.seq)) return;
      const cursor = cursorRef.current.get(event.table);
      if (cursor && BigInt(event.seq) <= BigInt(cursor)) return;

      updateCursor(event.table, event.seq);
      setEvents((prev) => [
        { ...event, id: crypto.randomUUID() },
        ...prev.slice(0, MAX_EVENTS - 1),
      ]);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      snapshotRequests.forEach((controller) => controller.abort());
      snapshotRequests.clear();
    };
  }, [anonKey, handleSubscribeAck, syncTableSnapshot, updateCursor]);

  /** 开启/关闭单表的实时订阅，同时开关数据库触发器 */
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

      const realtimeBase = `${env.apiUrl}/orgs/${orgSlug}/projects/${projectSlug}/realtime/${encodeURIComponent(tableName)}`;

      try {
        if (enabled) {
          const response = await fetch(`${realtimeBase}/enable`, {
            method: 'POST',
            credentials: 'include',
          });
          if (!response.ok) {
            throw new Error('Could not enable Realtime for this table');
          }

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
          return;
        }

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

        setSnapshotSyncing(removeFromSet(tableName));
        setTableSnapshots(removeFromMap(tableName));
        setSnapshotSyncedAt(removeFromMap(tableName));
        setSnapshotErrors(removeFromMap(tableName));
        setSnapshotNotices(removeFromMap(tableName));

        const response = await fetch(`${realtimeBase}/disable`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!response.ok) {
          throw new Error(
            'Stopped listening, but could not disable the database trigger',
          );
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
      anonKey,
      handleSubscribeAck,
      orgSlug,
      pendingTables,
      projectSlug,
      syncTableSnapshot,
    ],
  );

  const clearEvents = useCallback(() => setEvents([]), []);

  return {
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
  };
}

/** 生成「从 Set 中移除某个 key」的更新函数 */
function removeFromSet(key: string) {
  return (prev: Set<string>) => {
    const next = new Set(prev);
    next.delete(key);
    return next;
  };
}

/** 生成「从 Map 中移除某个 key」的更新函数 */
function removeFromMap<T>(key: string) {
  return (prev: Map<string, T>) => {
    const next = new Map(prev);
    next.delete(key);
    return next;
  };
}
