import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ViolationWithDetails } from '@tracearr/shared';
import { createMockActiveSession } from '../../../test/fixtures.js';
import { PayloadBuilders, toNotificationPayload } from '../types.js';

const system = { kind: 'system' } as const;

const violation: ViolationWithDetails = {
  id: 'violation-123',
  ruleId: 'rule-456',
  serverUserId: 'user-789',
  sessionId: 'session-123',
  severity: 'warning',
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

const pluginPayload = {
  serverId: 'server-1',
  serverName: 'Jellyfin',
  serverType: 'jellyfin',
  installedVersion: '0.2.0',
  latestVersion: '0.3.0',
  downloadUrl: 'https://example.com/plugin.zip',
};

const mediaPayload = {
  serverId: 'server-1',
  serverName: 'Basement',
  serverType: 'plex',
  libraryItemId: 'item-1',
  title: 'Cars',
  grandparentTitle: null,
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
};

const upgradedPayload = {
  ...mediaPayload,
  from: { ...mediaPayload.to, resolution: '1080p', fileSize: 8_000_000_000 },
  changed: ['resolution', 'fileSize'] as ('resolution' | 'fileSize')[],
};

describe('toNotificationPayload', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('matches PayloadBuilders for each event type', () => {
    expect(toNotificationPayload({ type: 'violation', payload: violation }, system)).toEqual(
      PayloadBuilders.fromViolation(violation)
    );
    expect(toNotificationPayload({ type: 'session_started', payload: session }, system)).toEqual(
      PayloadBuilders.fromSessionStarted(session)
    );
    expect(toNotificationPayload({ type: 'session_stopped', payload: session }, system)).toEqual(
      PayloadBuilders.fromSessionStopped(session)
    );
    expect(
      toNotificationPayload(
        { type: 'server_down', payload: { serverName: 'Plex', serverId: 's1' } },
        system
      )
    ).toEqual(PayloadBuilders.fromServerDown('Plex'));
    expect(
      toNotificationPayload(
        { type: 'server_up', payload: { serverName: 'Plex', serverId: 's1' } },
        system
      )
    ).toEqual(PayloadBuilders.fromServerUp('Plex'));
    expect(
      toNotificationPayload({ type: 'plugin_update_available', payload: pluginPayload }, system)
    ).toEqual(
      PayloadBuilders.fromPluginUpdate(
        pluginPayload.serverId,
        pluginPayload.serverName,
        pluginPayload.serverType,
        pluginPayload.installedVersion,
        pluginPayload.latestVersion,
        pluginPayload.downloadUrl
      )
    );
  });

  it('lets a rule source override title and message but keeps the event severity', () => {
    const payload = toNotificationPayload(
      { type: 'session_started', payload: session },
      { kind: 'rule', title: 'Rule fired', message: 'Too many streams' }
    );

    expect(payload.title).toBe('Rule fired');
    expect(payload.message).toBe('Too many streams');
    expect(payload.severity).toBe('low');
    expect(payload.event).toBe('stream_started');
    expect(payload.context).toEqual({ type: 'stream_started', session });
  });
});

const automation = (over: { title?: string; body?: string } = {}) =>
  ({ kind: 'automation', automationId: 'a-1', automationName: 'Now playing', ...over }) as const;

describe('toNotificationPayload with an automation source', () => {
  it('substitutes the trigger variables into the body of a native event', () => {
    const payload = toNotificationPayload(
      { type: 'session_started', payload: session },
      automation({ body: '{{user.username}} started {{session.mediaTitle}}' })
    );

    expect(payload.message).toBe(`${session.user.username} started ${session.mediaTitle}`);
    expect(payload.automation).toEqual({
      id: 'a-1',
      name: 'Now playing',
      message: `${session.user.username} started ${session.mediaTitle}`,
    });
  });

  it('renders an unknown variable as nothing and keeps the builtin text without an override', () => {
    const rendered = toNotificationPayload(
      { type: 'session_started', payload: session },
      automation({ title: 'Playing on {{server.name}}{{nope}}' })
    );

    expect(rendered.title).toBe(`Playing on ${session.server.name}`);
    expect(rendered.message).toBe(PayloadBuilders.fromSessionStarted(session).message);
    expect(rendered.automation?.title).toBe(`Playing on ${session.server.name}`);
    expect(rendered.automation?.message).toBeUndefined();
  });

  it('carries the automation with no overrides at all', () => {
    const payload = toNotificationPayload({ type: 'violation', payload: violation }, automation());

    expect(payload.title).toBe(PayloadBuilders.fromViolation(violation).title);
    expect(payload.automation).toEqual({ id: 'a-1', name: 'Now playing' });
  });

  it('substitutes the update variables of a tracearr release', () => {
    const payload = toNotificationPayload(
      {
        type: 'tracearr_update_available',
        payload: { current: '2.0.0', latest: '2.1.0', releaseUrl: 'https://example.com/r' },
      },
      automation({ title: 'Tracearr {{latest}}', body: '{{current}} -> {{latest}}' })
    );

    expect(payload.title).toBe('Tracearr 2.1.0');
    expect(payload.message).toBe('2.0.0 -> 2.1.0');
    expect(payload.event).toBe('tracearr_update_available');
  });

  it('resolves the server name and type of a native server event', () => {
    const payload = toNotificationPayload(
      {
        type: 'server_down',
        payload: { serverName: 'Living Room', serverId: 's1', serverType: 'jellyfin' },
      },
      automation({ body: '{{server.name}} ({{server.type}}) is gone' })
    );

    expect(payload.message).toBe('Living Room (jellyfin) is gone');
    expect(payload.context).toEqual({
      type: 'server_down',
      serverName: 'Living Room',
      serverType: 'jellyfin',
    });
  });

  it('resolves the server name and type of a violation-shaped run', () => {
    const payload = toNotificationPayload(
      {
        type: 'violation',
        payload: { ...violation, server: { id: 's1', name: 'Living Room', type: 'emby' } },
      },
      automation({ body: '{{server.name}} / {{server.type}}' })
    );

    expect(payload.message).toBe('Living Room / emby');
  });

  it('reads the account name and media title off a violation-shaped run', () => {
    const payload = toNotificationPayload(
      {
        type: 'violation',
        payload: {
          ...violation,
          data: { ...violation.data, mediaTitle: 'Arrival', days: 45 },
        },
      },
      automation({ body: '{{user.identityName}} / {{session.mediaTitle}} / {{days}}' })
    );

    expect(payload.message).toBe('Test User / Arrival / 45');
  });
});

describe('media events', () => {
  it('names the item, the library and the server by default', () => {
    const added = toNotificationPayload({ type: 'media_added', payload: mediaPayload }, system);

    expect(added.title).toBe('New media added');
    expect(added.message).toBe('Cars (2006) was added to Movies on Basement');
    expect(added.event).toBe('media_added');
    expect(added.context).toEqual({ type: 'media_added', ...mediaPayload });
  });

  it('leads an upgrade with the resolution pair', () => {
    const upgraded = toNotificationPayload(
      { type: 'media_upgraded', payload: upgradedPayload },
      system
    );

    expect(upgraded.title).toBe('Media upgraded');
    expect(upgraded.message).toBe('Cars on Basement: 1080p → 4K');
  });

  it('falls back to the first field that moved when the resolution held', () => {
    const upgraded = toNotificationPayload(
      {
        type: 'media_upgraded',
        payload: { ...upgradedPayload, changed: ['fileSize'] as 'fileSize'[] },
      },
      system
    );

    expect(upgraded.message).toBe('Cars on Basement: 7.5 GB → 39.1 GB');
  });

  it('renders the from and to variables an automation body names', () => {
    const upgraded = toNotificationPayload(
      { type: 'media_upgraded', payload: upgradedPayload },
      automation({ body: '{{media.title}}: {{media.from.resolution}} → {{media.to.resolution}}' })
    );

    expect(upgraded.message).toBe('Cars: 1080p → 4K');
  });

  it('names the show or artist an episode or track belongs to', () => {
    const episode = { ...mediaPayload, title: 'Pilot', grandparentTitle: 'Severance' };

    expect(toNotificationPayload({ type: 'media_added', payload: episode }, system).message).toBe(
      'Severance — Pilot (2006) was added to Movies on Basement'
    );
    expect(
      toNotificationPayload(
        { type: 'media_upgraded', payload: { ...upgradedPayload, ...episode } },
        system
      ).message
    ).toBe('Severance — Pilot on Basement: 1080p → 4K');
  });

  it('renders a missing year and the item variables as the trigger offers them', () => {
    const added = toNotificationPayload(
      { type: 'media_added', payload: { ...mediaPayload, year: null } },
      automation({ body: '{{media.title}}|{{media.year}}|{{media.library}}|{{media.server}}' })
    );

    expect(added.message).toBe('Cars||Movies|Basement');
    expect(
      toNotificationPayload(
        { type: 'media_added', payload: { ...mediaPayload, year: null } },
        system
      ).message
    ).toBe('Cars was added to Movies on Basement');
  });
});
