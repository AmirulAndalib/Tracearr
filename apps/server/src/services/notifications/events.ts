import type { ActiveSession, NotificationEventType, ViolationWithDetails } from '@tracearr/shared';

export type NotificationEvent =
  | { type: 'violation'; payload: ViolationWithDetails }
  | { type: 'session_started'; payload: ActiveSession }
  | { type: 'session_stopped'; payload: ActiveSession }
  | { type: 'server_down'; payload: { serverName: string; serverId: string } }
  | { type: 'server_up'; payload: { serverName: string; serverId: string } }
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
    };

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
