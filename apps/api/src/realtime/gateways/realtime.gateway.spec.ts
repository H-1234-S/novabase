import { describe, expect, it, vi } from 'vitest';
import { RealtimeGateway } from './realtime.gateway.js';
import { PROJECT_KEY_ROLES } from '@novabase/constants';

const projectId = '9b5bfc38-60d6-4f35-93cc-649142e48ad4';

function createGateway() {
  const operations: string[] = [];
  const realtimeService = {
    currentCursor: vi.fn(async () => '0'),
    replay: vi.fn(async () => ({
      gap: 'none' as const,
      cursor: '0',
      replayed: 0,
      events: [],
    })),
    subscribe: vi.fn(async () => {
      operations.push('listen');
    }),
    unsubscribe: vi.fn(async () => undefined),
    operations,
  };
  const jwtService = {
    verify: vi.fn(() => ({ projectId, role: PROJECT_KEY_ROLES.ANON })),
  };
  const configService = { get: vi.fn(() => 'test-secret') };
  const gateway = new RealtimeGateway(
    realtimeService as never,
    jwtService as never,
    configService as never,
  );
  return { gateway, realtimeService, jwtService };
}

function createSocket(id = 'socket-1') {
  return {
    id,
    connected: true,
    data: {} as Record<string, unknown>,
    handshake: { auth: { token: 'anon-key' } },
    join: vi.fn(async () => undefined),
    leave: vi.fn(async () => undefined),
    emit: vi.fn(),
    disconnect: vi.fn(),
  } as any;
}

describe('RealtimeGateway', () => {
  it('rejects unsafe subscription payloads before touching rooms or database', async () => {
    const { gateway, realtimeService } = createGateway();
    const socket = createSocket();
    await gateway.handleConnection(socket);
    const ack = vi.fn();

    await gateway.handleSubscribe(socket, 'posts; SELECT 1', ack);

    expect(ack).toHaveBeenCalledWith({
      ok: false,
      code: 'INVALID_TABLE',
      message: 'Invalid table name',
    });
    expect(socket.join).toHaveBeenCalledTimes(1); // project room only
    expect(realtimeService.subscribe).not.toHaveBeenCalled();
  });

  it('acknowledges a table subscription only after the listener is ready', async () => {
    const { gateway, realtimeService } = createGateway();
    const socket = createSocket();
    await gateway.handleConnection(socket);
    const ack = vi.fn();

    await gateway.handleSubscribe(socket, 'posts', ack);

    expect(realtimeService.subscribe).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledWith({
      ok: true,
      cursor: '0',
      gap: 'none',
      replayed: 0,
    });
    expect(socket.join).toHaveBeenCalledWith(
      `project:${projectId}:table:posts`,
    );
    expect(realtimeService.replay).toHaveBeenCalledTimes(2);
  });

  it('accepts table objects with a cursor and replays before joining the room', async () => {
    const { gateway, realtimeService } = createGateway();
    const socket = createSocket();
    await gateway.handleConnection(socket);
    const order = realtimeService.operations as string[];
    realtimeService.subscribe.mockImplementationOnce(async () => {
      order.push('listen');
    });
    realtimeService.replay.mockImplementation(async () => {
      order.push('replay');
      return {
        gap: 'replayed',
        cursor: '12',
        replayed: 1,
        events: [
          {
            version: 1,
            seq: '12',
            type: 'INSERT',
            table: 'posts',
            record: null,
            projectId,
            timestamp: new Date().toISOString(),
          },
        ],
      } as never;
    });
    socket.join.mockImplementation(async (room: string) => {
      if (room.includes(':table:')) order.push('join');
    });
    const ack = vi.fn();

    await gateway.handleSubscribe(socket, { table: 'posts', since: '11' }, ack);

    expect(order).toEqual(['listen', 'replay', 'join', 'replay']);
    expect(realtimeService.replay).toHaveBeenNthCalledWith(
      1,
      projectId,
      'posts',
      '11',
    );
    expect(socket.emit).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ seq: '12' }),
    );
    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, cursor: '12', gap: 'replayed' }),
    );
  });

  it('rejects a malformed cursor before subscribing', async () => {
    const { gateway, realtimeService } = createGateway();
    const socket = createSocket();
    await gateway.handleConnection(socket);
    const ack = vi.fn();

    await gateway.handleSubscribe(socket, { table: 'posts', since: '1;2' }, ack);

    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, code: 'INVALID_CURSOR' }),
    );
    expect(realtimeService.subscribe).not.toHaveBeenCalled();
  });

  it('cancels a subscribe that completes after socket disconnect', async () => {
    const { gateway, realtimeService } = createGateway();
    const socket = createSocket();
    await gateway.handleConnection(socket);
    let finishSubscribe!: () => void;
    realtimeService.subscribe.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishSubscribe = resolve)),
    );
    const ack = vi.fn();

    const subscribing = gateway.handleSubscribe(socket, 'posts', ack);
    await Promise.resolve();
    await Promise.resolve();
    await gateway.handleDisconnect(socket);
    socket.connected = false;
    finishSubscribe();
    await subscribing;

    expect(realtimeService.unsubscribe).toHaveBeenCalled();
    expect(socket.leave).toHaveBeenCalledWith(
      `project:${projectId}:table:posts`,
    );
    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, code: 'SUBSCRIPTION_CANCELLED' }),
    );
  });
});
