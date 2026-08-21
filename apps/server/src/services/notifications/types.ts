/**
 * Notification payload types shared by every destination type module.
 */

import { BYTES_PER_GB, normalizeResolutionLabel } from '@tracearr/shared';
import { MEDIA_QUALITY_FIELDS } from '../automations/types.js';
import type { ViolationWithDetails, ActiveSession, NotificationEventType } from '@tracearr/shared';
import type { MediaQuality } from '../automations/types.js';
import type {
  MediaEventPayload,
  MediaUpgradedPayload,
  NotificationEvent,
  NotificationSource,
} from './events.js';

// Re-export for convenience
export type { ViolationWithDetails, ActiveSession, NotificationEventType };

/**
 * Severity levels for notifications
 */
export type NotificationSeverity = 'low' | 'warning' | 'high';

/**
 * Context provided with violation notifications
 */
export interface ViolationContext {
  type: 'violation_detected';
  violation: ViolationWithDetails;
}

/**
 * Context provided with session notifications
 */
export interface SessionContext {
  type: 'stream_started' | 'stream_stopped';
  session: ActiveSession;
}

/**
 * Context provided with server status notifications
 */
export interface ServerContext {
  type: 'server_down' | 'server_up';
  serverName: string;
  serverType?: 'plex' | 'jellyfin' | 'emby';
}

/**
 * Context provided with plugin update notifications
 */
export interface PluginUpdateContext {
  type: 'plugin_update_available';
  serverId: string;
  serverName: string;
  serverType: string;
  installedVersion: string | null;
  latestVersion: string;
  downloadUrl: string;
}

/**
 * Context provided with media server update notifications
 */
export interface ServerUpdateContext {
  type: 'server_update_available';
  serverId: string;
  serverName: string;
  serverType: string;
  installedVersion: string;
  latestVersion: string;
  releaseUrl: string;
}

/**
 * Context provided with Tracearr release notifications
 */
export interface TracearrUpdateContext {
  type: 'tracearr_update_available';
  current: string;
  latest: string;
  releaseUrl: string;
}

/**
 * Context provided with a library item that just appeared
 */
export interface MediaAddedContext extends MediaEventPayload {
  type: 'media_added';
}

/**
 * Context provided with a library item whose quality signature moved
 */
export interface MediaUpgradedContext extends MediaUpgradedPayload {
  type: 'media_upgraded';
}

/**
 * Union of all notification contexts
 */
export type NotificationContext =
  | ViolationContext
  | SessionContext
  | ServerContext
  | PluginUpdateContext
  | ServerUpdateContext
  | TracearrUpdateContext
  | MediaAddedContext
  | MediaUpgradedContext;

/**
 * Unified notification payload for all agents
 */
export interface NotificationPayload {
  /** Event type identifier */
  event: NotificationEventType;

  /** Human-readable title */
  title: string;

  /** Human-readable message body */
  message: string;

  /** Severity level (affects priority in some agents) */
  severity: NotificationSeverity;

  /** ISO timestamp */
  timestamp: string;

  /** Additional context based on event type */
  context: NotificationContext;

  /** Optional image URL (e.g., poster) */
  imageUrl?: string;

  /** The automation whose send produced this, with whatever text it overrode already rendered. */
  automation?: { id: string; name: string; title?: string; message?: string };
}

const titleWithYear = (ctx: MediaEventPayload): string =>
  ctx.year === null ? ctx.title : `${ctx.title} (${String(ctx.year)})`;

/** Values as a message shows them: bytes in GB, a resolution in its display spelling. */
function qualityText(field: keyof MediaQuality, value: string | number | null): string {
  if (value === null) return '';
  if (field === 'fileSize') return `${(Number(value) / BYTES_PER_GB).toFixed(1)} GB`;
  if (field === 'resolution') return normalizeResolutionLabel(String(value)) ?? String(value);
  return String(value);
}

/** The resolution pair when that is what moved, else the first field that did. */
function qualityMove(ctx: MediaUpgradedPayload): string {
  const field = ctx.changed.includes('resolution') ? 'resolution' : ctx.changed[0];
  if (!field) return '';
  return `: ${qualityText(field, ctx.from[field])} → ${qualityText(field, ctx.to[field])}`;
}

/**
 * Payload builders for creating NotificationPayload from raw data
 */
export const PayloadBuilders = {
  fromViolation(violation: ViolationWithDetails): NotificationPayload {
    const userName = violation.user.identityName ?? violation.user.username;
    return {
      event: 'violation_detected',
      title: 'Violation Detected',
      message: `User ${userName} triggered a rule violation`,
      severity: violation.severity,
      timestamp: new Date().toISOString(),
      context: { type: 'violation_detected', violation },
    };
  },

  fromSessionStarted(session: ActiveSession): NotificationPayload {
    const userName = session.user.identityName ?? session.user.username;
    return {
      event: 'stream_started',
      title: 'Stream Started',
      message: `${userName} started streaming`,
      severity: 'low',
      timestamp: new Date().toISOString(),
      context: { type: 'stream_started', session },
    };
  },

  fromSessionStopped(session: ActiveSession): NotificationPayload {
    const userName = session.user.identityName ?? session.user.username;
    return {
      event: 'stream_stopped',
      title: 'Stream Stopped',
      message: `${userName} stopped streaming`,
      severity: 'low',
      timestamp: new Date().toISOString(),
      context: { type: 'stream_stopped', session },
    };
  },

  fromServerDown(
    serverName: string,
    serverType?: 'plex' | 'jellyfin' | 'emby'
  ): NotificationPayload {
    return {
      event: 'server_down',
      title: 'Server Offline',
      message: `${serverName} is not responding`,
      severity: 'high',
      timestamp: new Date().toISOString(),
      context: { type: 'server_down', serverName, serverType },
    };
  },

  fromServerUp(serverName: string, serverType?: 'plex' | 'jellyfin' | 'emby'): NotificationPayload {
    return {
      event: 'server_up',
      title: 'Server Online',
      message: `${serverName} is back online`,
      severity: 'low',
      timestamp: new Date().toISOString(),
      context: { type: 'server_up', serverName, serverType },
    };
  },

  fromServerUpdate(ctx: Omit<ServerUpdateContext, 'type'>): NotificationPayload {
    return {
      event: 'server_update_available',
      title: 'Server Update Available',
      message: `${ctx.serverName} can update from ${ctx.installedVersion} to ${ctx.latestVersion}`,
      severity: 'low',
      timestamp: new Date().toISOString(),
      context: { type: 'server_update_available', ...ctx },
    };
  },

  fromTracearrUpdate(ctx: Omit<TracearrUpdateContext, 'type'>): NotificationPayload {
    return {
      event: 'tracearr_update_available',
      title: 'Tracearr Update Available',
      message: `Tracearr ${ctx.latest} is out (running ${ctx.current})`,
      severity: 'low',
      timestamp: new Date().toISOString(),
      context: { type: 'tracearr_update_available', ...ctx },
    };
  },

  fromMediaAdded(ctx: MediaEventPayload): NotificationPayload {
    return {
      event: 'media_added',
      title: 'New media added',
      message: `${titleWithYear(ctx)} was added to ${ctx.libraryName} on ${ctx.serverName}`,
      severity: 'low',
      timestamp: new Date().toISOString(),
      context: { type: 'media_added', ...ctx },
    };
  },

  fromMediaUpgraded(ctx: MediaUpgradedPayload): NotificationPayload {
    return {
      event: 'media_upgraded',
      title: 'Media upgraded',
      message: `${ctx.title} on ${ctx.serverName}${qualityMove(ctx)}`,
      severity: 'low',
      timestamp: new Date().toISOString(),
      context: { type: 'media_upgraded', ...ctx },
    };
  },

  fromPluginUpdate(
    serverId: string,
    serverName: string,
    serverType: string,
    installedVersion: string | null,
    latestVersion: string,
    downloadUrl: string
  ): NotificationPayload {
    const installed = installedVersion ?? 'pre-0.2.0';
    return {
      event: 'plugin_update_available',
      title: 'Plugin Update Available',
      message: `${serverName} plugin is outdated (installed ${installed}, latest ${latestVersion})`,
      severity: 'low',
      timestamp: new Date().toISOString(),
      context: {
        type: 'plugin_update_available',
        serverId,
        serverName,
        serverType,
        installedVersion,
        latestVersion,
        downloadUrl,
      },
    };
  },
};

/** Anything the payload holds that a template can name; objects and nulls render as nothing. */
function scalar(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function mediaVariables(payload: MediaEventPayload): Record<string, string> {
  return {
    'media.title': payload.title,
    'media.type': payload.mediaType,
    'media.year': payload.year === null ? '' : String(payload.year),
    'media.library': payload.libraryName,
    'media.server': payload.serverName,
    'server.name': payload.serverName,
    'server.type': payload.serverType,
  };
}

function qualityVariables(side: 'from' | 'to', quality: MediaQuality): Record<string, string> {
  return Object.fromEntries(
    MEDIA_QUALITY_FIELDS.map((field) => [
      `media.${side}.${field}`,
      qualityText(field, quality[field]),
    ])
  );
}

/** The TRIGGERS variable vocabulary, read off whatever the event carries. */
function variablesOf(event: NotificationEvent): Record<string, string> {
  switch (event.type) {
    case 'violation': {
      const v = event.payload;
      const data = v.data ?? {};
      return {
        'user.username': v.user.username,
        'user.identityName': v.user.identityName ?? v.user.username,
        'session.mediaTitle': scalar(data.mediaTitle),
        'session.mediaType': scalar(data.mediaType),
        'server.name': v.server?.name ?? scalar(data.serverName),
        'server.type': v.server?.type ?? '',
        durationMinutes: scalar(data.durationMinutes),
        minutes: scalar(data.minutes),
        days: scalar(data.days),
      };
    }
    case 'session_started':
    case 'session_stopped': {
      const s = event.payload;
      return {
        'user.username': s.user.username,
        'user.identityName': s.user.identityName ?? s.user.username,
        'session.mediaTitle': s.mediaTitle,
        'session.mediaType': s.mediaType,
        'server.name': s.server.name,
        'server.type': s.server.type,
        durationMinutes: s.durationMs === null ? '' : String(Math.round(s.durationMs / 60_000)),
      };
    }
    case 'server_down':
    case 'server_up':
      return {
        'server.name': event.payload.serverName,
        'server.type': event.payload.serverType ?? '',
      };
    case 'plugin_update_available': {
      const p = event.payload;
      return {
        'server.name': p.serverName,
        'server.type': p.serverType,
        installedVersion: p.installedVersion ?? '',
        latestVersion: p.latestVersion,
        downloadUrl: p.downloadUrl,
      };
    }
    case 'server_update_available': {
      const p = event.payload;
      return {
        'server.name': p.serverName,
        'server.type': p.serverType,
        installedVersion: p.installedVersion,
        latestVersion: p.latestVersion,
        releaseUrl: p.releaseUrl,
      };
    }
    case 'tracearr_update_available':
      return {
        current: event.payload.current,
        latest: event.payload.latest,
        releaseUrl: event.payload.releaseUrl,
      };
    case 'media_added':
      return mediaVariables(event.payload);
    case 'media_upgraded':
      return {
        ...mediaVariables(event.payload),
        ...qualityVariables('from', event.payload.from),
        ...qualityVariables('to', event.payload.to),
      };
  }
}

const VARIABLE = /\{\{\s*([\w.]+)\s*\}\}/g;

/** A name the trigger does not offer renders as nothing rather than leaving the braces in. */
function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(VARIABLE, (_match, name: string) => variables[name] ?? '');
}

/** One NotificationPayload per event; an automation's send may override the text. */
export function toNotificationPayload(
  event: NotificationEvent,
  source: NotificationSource
): NotificationPayload {
  const base = ((): NotificationPayload => {
    switch (event.type) {
      case 'violation':
        return PayloadBuilders.fromViolation(event.payload);
      case 'session_started':
        return PayloadBuilders.fromSessionStarted(event.payload);
      case 'session_stopped':
        return PayloadBuilders.fromSessionStopped(event.payload);
      case 'server_down':
        return PayloadBuilders.fromServerDown(event.payload.serverName, event.payload.serverType);
      case 'server_up':
        return PayloadBuilders.fromServerUp(event.payload.serverName, event.payload.serverType);
      case 'plugin_update_available': {
        const p = event.payload;
        return PayloadBuilders.fromPluginUpdate(
          p.serverId,
          p.serverName,
          p.serverType,
          p.installedVersion,
          p.latestVersion,
          p.downloadUrl
        );
      }
      case 'server_update_available':
        return PayloadBuilders.fromServerUpdate(event.payload);
      case 'tracearr_update_available':
        return PayloadBuilders.fromTracearrUpdate(event.payload);
      case 'media_added':
        return PayloadBuilders.fromMediaAdded(event.payload);
      case 'media_upgraded':
        return PayloadBuilders.fromMediaUpgraded(event.payload);
    }
  })();
  if (source.kind === 'rule') {
    return { ...base, title: source.title, message: source.message };
  }
  if (source.kind !== 'automation') return base;

  const variables = variablesOf(event);
  const title = source.title === undefined ? undefined : renderTemplate(source.title, variables);
  const message = source.body === undefined ? undefined : renderTemplate(source.body, variables);
  return {
    ...base,
    title: title ?? base.title,
    message: message ?? base.message,
    automation: {
      id: source.automationId,
      name: source.automationName,
      ...(title !== undefined && { title }),
      ...(message !== undefined && { message }),
    },
  };
}
