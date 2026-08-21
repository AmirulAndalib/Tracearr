import type { ActiveSession, NotificationEventType, ViolationWithDetails } from '@tracearr/shared';
import type { MediaQuality } from '../automations/types.js';

/** The SSE fallback's down timer holds only the name and id, so the type is optional. */
export interface ServerEventPayload {
  serverName: string;
  serverId: string;
  serverType?: 'plex' | 'jellyfin' | 'emby';
}

/** One library item, flat, with `to` holding the quality it ends the sync at. */
export interface MediaEventPayload {
  serverId: string;
  serverName: string;
  serverType: string;
  libraryItemId: string;
  title: string;
  mediaType: string;
  year: number | null;
  libraryName: string;
  to: MediaQuality;
}

export interface MediaUpgradedPayload extends MediaEventPayload {
  from: MediaQuality;
  changed: (keyof MediaQuality)[];
}

export type NotificationEvent =
  | { type: 'violation'; payload: ViolationWithDetails }
  | { type: 'session_started'; payload: ActiveSession }
  | { type: 'session_stopped'; payload: ActiveSession }
  | { type: 'server_down'; payload: ServerEventPayload }
  | { type: 'server_up'; payload: ServerEventPayload }
  | {
      type: 'plugin_update_available';
      payload: {
        serverId: string;
        serverName: string;
        serverType: string;
        installedVersion: string | null;
        latestVersion: string;
        downloadUrl: string;
      };
    }
  | {
      type: 'server_update_available';
      payload: {
        serverId: string;
        serverName: string;
        serverType: string;
        installedVersion: string;
        latestVersion: string;
        releaseUrl: string;
      };
    }
  | {
      type: 'tracearr_update_available';
      payload: { current: string; latest: string; releaseUrl: string };
    }
  | { type: 'media_added'; payload: MediaEventPayload }
  | { type: 'media_upgraded'; payload: MediaUpgradedPayload };

/** Producers keep their discriminators; rows and the UI use NotificationEventType names. */
export const JOB_TYPE_TO_EVENT_TYPE: Record<NotificationEvent['type'], NotificationEventType> = {
  violation: 'violation_detected',
  session_started: 'stream_started',
  session_stopped: 'stream_stopped',
  server_down: 'server_down',
  server_up: 'server_up',
  plugin_update_available: 'plugin_update_available',
  server_update_available: 'server_update_available',
  tracearr_update_available: 'tracearr_update_available',
  media_added: 'media_added',
  media_upgraded: 'media_upgraded',
};

export function eventTypeOf(event: NotificationEvent): NotificationEventType {
  return JOB_TYPE_TO_EVENT_TYPE[event.type];
}

/**
 * An automation's send names itself and may override the text with `{{variable}}` templates;
 * system events are formatted per type from the payload. `rule` is the pre-automation shape,
 * kept one release so jobs already queued at upgrade still render.
 */
export type NotificationSource =
  | { kind: 'system' }
  | { kind: 'rule'; title: string; message: string }
  | {
      kind: 'automation';
      automationId: string;
      automationName: string;
      title?: string;
      body?: string;
    };
