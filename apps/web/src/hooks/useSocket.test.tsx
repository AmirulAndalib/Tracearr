import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const fake = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const socket = {
    recovered: false,
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers.set(event, cb);
      return socket;
    }),
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
  return {
    socket,
    handlers,
    io: vi.fn((_opts?: Record<string, unknown>) => socket),
    auth: { isAuthenticated: true },
    maintenance: { isInMaintenance: false, isUnreachable: false },
  };
});

vi.mock('socket.io-client', () => ({ io: fake.io }));
vi.mock('./useAuth', () => ({ useAuth: () => fake.auth }));
vi.mock('./useMaintenanceMode', () => ({ useMaintenanceMode: () => fake.maintenance }));
vi.mock('./queries', () => ({ useChannelRouting: () => ({ data: undefined }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('sonner', () => ({ toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api', () => ({
  api: {
    servers: {
      health: vi.fn().mockResolvedValue([]),
      connectionStatus: vi.fn().mockResolvedValue([]),
    },
  },
}));

import { SocketProvider, useSocket } from './useSocket';

function setup() {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SocketProvider>{children}</SocketProvider>
      </QueryClientProvider>
    );
  }
  const view = renderHook(() => useSocket(), { wrapper });
  return { ...view, invalidate };
}

function fire(event: string, ...args: unknown[]) {
  act(() => {
    fake.handlers.get(event)?.(...args);
  });
}

describe('SocketProvider', () => {
  beforeEach(() => {
    fake.io.mockClear();
    fake.socket.on.mockClear();
    fake.socket.disconnect.mockClear();
    fake.socket.recovered = false;
    fake.handlers.clear();
    fake.auth.isAuthenticated = true;
    fake.maintenance.isInMaintenance = false;
    fake.maintenance.isUnreachable = false;
  });

  it('lets socket.io keep retrying instead of capping reconnection attempts', () => {
    setup();
    const opts = fake.io.mock.calls[0]?.[0];
    expect(opts).toBeDefined();
    expect(opts?.reconnectionAttempts).toBeUndefined();
  });

  it('keeps the socket while the server is merely unreachable', () => {
    const { rerender } = setup();
    fake.maintenance.isUnreachable = true;
    rerender();

    expect(fake.io).toHaveBeenCalledTimes(1);
    expect(fake.socket.disconnect).not.toHaveBeenCalled();
  });

  it('tears the socket down when the server reports maintenance', () => {
    const { rerender } = setup();
    fake.maintenance.isInMaintenance = true;
    rerender();

    expect(fake.socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it('refetches after a plain reconnect but not after a recovered one', () => {
    const { invalidate } = setup();
    fire('connect');
    expect(invalidate).not.toHaveBeenCalled();

    fire('disconnect');
    fire('connect');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sessions', 'active'] });

    invalidate.mockClear();
    fake.socket.recovered = true;
    fire('disconnect');
    fire('connect');
    expect(invalidate).not.toHaveBeenCalled();
  });
});
