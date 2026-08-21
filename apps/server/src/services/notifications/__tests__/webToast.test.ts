import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViolationWithDetails } from '@tracearr/shared';
import { getPubSubService, type PubSubService } from '../../cache.js';
import { createMockActiveSession } from '../../../test/fixtures.js';
import { webToastType, type ToastRendered } from '../destinations/webToast.js';
import type { RenderContext } from '../destinations/types.js';

vi.mock('../../cache.js', () => ({ getPubSubService: vi.fn() }));

const destination = { id: 'dest-toast', name: 'Browser toast' };
const systemCtx: RenderContext = { destination, source: { kind: 'system' } };
const ruleCtx: RenderContext = {
  destination,
  source: { kind: 'rule', title: 'Rule fired', message: 'Too many streams' },
};
const automationCtx = (over: { title?: string; body?: string } = {}): RenderContext => ({
  destination,
  source: { kind: 'automation', automationId: 'a-1', automationName: 'Now playing', ...over },
});
const deliverCtx = { destination, signal: AbortSignal.timeout(5000) };

const violation: ViolationWithDetails = {
  id: 'violation-123',
  ruleId: 'rule-456',
  serverUserId: 'user-789',
  sessionId: 'session-123',
  severity: 'high',
  data: { reason: 'test violation' },
  acknowledgedAt: null,
  createdAt: new Date('2026-01-02T03:04:05.000Z'),
  user: {
    id: 'user-789',
    username: 'testuser',
    serverId: 'server-id',
    thumbUrl: null,
    identityName: 'Test User',
  },
  rule: { id: 'rule-456', name: 'Test Rule', type: 'concurrent_streams' },
};

const session = createMockActiveSession();

const render = async (
  event: Parameters<typeof webToastType.render>[0],
  ctx: RenderContext = systemCtx
): Promise<ToastRendered> => webToastType.render(event, {}, ctx);

describe('webToastType.render', () => {
  it('renders server down as a server:down publish', async () => {
    expect(
      await render({ type: 'server_down', payload: { serverName: 'Plex Server', serverId: 's1' } })
    ).toEqual({
      server: { event: 'server:down', data: { serverName: 'Plex Server', serverId: 's1' } },
    });
  });

  it('renders server up as a server:up publish', async () => {
    expect(
      await render({ type: 'server_up', payload: { serverName: 'Plex Server', serverId: 's1' } })
    ).toEqual({
      server: { event: 'server:up', data: { serverName: 'Plex Server', serverId: 's1' } },
    });
  });

  it('renders nothing for system stream events', async () => {
    expect(await render({ type: 'session_started', payload: session })).toEqual({});
    expect(await render({ type: 'session_stopped', payload: session })).toEqual({});
  });

  it('renders nothing for a system violation', async () => {
    expect(await render({ type: 'violation', payload: violation })).toEqual({});
  });

  it('renders a rule violation as a toast', async () => {
    expect(await render({ type: 'violation', payload: violation }, ruleCtx)).toEqual({
      toast: {
        title: 'Rule fired',
        message: 'Too many streams',
        automationId: 'rule-456',
        automationName: 'Test Rule',
        severity: 'high',
      },
    });
  });

  it('toasts an automation-sourced stream start with the automation behind it', async () => {
    expect(
      await render(
        { type: 'session_started', payload: session },
        automationCtx({ body: '{{user.username}} pressed play' })
      )
    ).toEqual({
      toast: {
        title: 'Stream Started',
        message: 'testuser pressed play',
        automationId: 'a-1',
        automationName: 'Now playing',
        severity: 'low',
      },
    });
  });

  it('toasts an automation-sourced violation shape', async () => {
    expect(await render({ type: 'violation', payload: violation }, automationCtx())).toEqual({
      toast: {
        title: 'Violation Detected',
        message: 'User Test User triggered a rule violation',
        automationId: 'a-1',
        automationName: 'Now playing',
        severity: 'high',
      },
    });
  });

  it('keeps the server data emit alongside an automation toast', async () => {
    const rendered = await render(
      { type: 'server_down', payload: { serverName: 'Plex Server', serverId: 's1' } },
      automationCtx({ title: '{{server.name}} is gone' })
    );

    expect(rendered.server).toEqual({
      event: 'server:down',
      data: { serverName: 'Plex Server', serverId: 's1' },
    });
    expect(rendered.toast?.title).toBe('Plex Server is gone');
  });

  it('toasts a tracearr release the automation asked for', async () => {
    const rendered = await render(
      {
        type: 'tracearr_update_available',
        payload: { current: '2.0.0', latest: '2.1.0', releaseUrl: 'https://example.com/r' },
      },
      automationCtx()
    );

    expect(rendered.toast?.title).toBe('Tracearr Update Available');
  });

  it('toasts a media add with the automation behind it and nothing for a system source', async () => {
    const event = {
      type: 'media_added',
      payload: {
        serverId: 'server-1',
        serverName: 'Basement',
        serverType: 'plex',
        libraryItemId: 'item-1',
        title: 'Cars',
        mediaType: 'movie',
        year: 2006,
        libraryName: 'Movies',
        to: {
          resolution: '4k',
          dynamicRange: 'hdr10',
          videoCodec: 'HEVC',
          audioCodec: 'TRUEHD',
          audioChannels: 8,
          fileSize: 42_000_000_000,
        },
      },
    } as const;

    const rendered = await render(event, automationCtx());

    expect(rendered.toast).toEqual({
      title: 'New media added',
      message: 'Cars (2006) was added to Movies on Basement',
      automationId: 'a-1',
      automationName: 'Now playing',
      severity: 'low',
    });
    expect(await render(event)).toEqual({});
  });
});

describe('webToastType.deliver', () => {
  const publish = vi.fn().mockResolvedValue(undefined);
  const mockGetPubSubService = vi.mocked(getPubSubService);

  beforeEach(() => {
    publish.mockClear();
    mockGetPubSubService.mockReturnValue({ publish } as unknown as PubSubService);
  });

  it('publishes server:down with the payload', async () => {
    await webToastType.deliver(
      { server: { event: 'server:down', data: { serverName: 'Plex', serverId: 's1' } } },
      {},
      deliverCtx
    );

    expect(publish).toHaveBeenCalledWith('server:down', { serverName: 'Plex', serverId: 's1' });
  });

  it('publishes the toast on notification:toast', async () => {
    const toast = {
      title: 'Rule fired',
      message: 'Too many streams',
      automationId: 'rule-456',
      automationName: 'Test Rule',
      severity: 'high',
    } as const;

    await webToastType.deliver({ toast }, {}, deliverCtx);

    expect(publish).toHaveBeenCalledWith('notification:toast', toast);
  });

  it('publishes both when a server event carries a toast', async () => {
    await webToastType.deliver(
      {
        server: { event: 'server:up', data: { serverName: 'Plex', serverId: 's1' } },
        toast: {
          title: 'Back',
          message: 'Plex is back',
          automationId: 'a-1',
          automationName: 'Server up',
          severity: 'low',
        },
      },
      {},
      deliverCtx
    );

    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('publishes nothing for an empty render', async () => {
    await webToastType.deliver({}, {}, deliverCtx);

    expect(publish).not.toHaveBeenCalled();
    expect(mockGetPubSubService).not.toHaveBeenCalled();
  });

  it('throws when pub/sub is unavailable', async () => {
    mockGetPubSubService.mockReturnValue(null);

    await expect(
      webToastType.deliver(
        { server: { event: 'server:down', data: { serverName: 'Plex', serverId: 's1' } } },
        {},
        deliverCtx
      )
    ).rejects.toThrow('pub/sub unavailable');
  });
});
