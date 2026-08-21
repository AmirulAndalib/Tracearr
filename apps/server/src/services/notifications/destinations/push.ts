import { DESTINATION_TYPES } from '@tracearr/shared';
import { pushNotificationService } from '../../pushNotification.js';
import { eventTypeOf } from '../events.js';
import { toNotificationPayload } from '../types.js';
import type { NotificationEvent } from '../events.js';
import type { DestinationType } from './types.js';

export interface PushOverride {
  title?: string;
  body?: string;
}

export type PushRendered =
  | { kind: 'event'; event: NotificationEvent; override?: PushOverride }
  /** The update events have no per-device toggle, so they carry their resolved text instead. */
  | { kind: 'update'; title: string; body: string; data: Record<string, unknown> };

const UPDATE_EVENTS: ReadonlySet<NotificationEvent['type']> = new Set([
  'plugin_update_available',
  'server_update_available',
  'tracearr_update_available',
]);

export const pushType: DestinationType<Record<string, never>, PushRendered> = {
  kind: 'push',
  events: DESTINATION_TYPES.push.events,
  render(event, _config, ctx) {
    // An automation asking for an update is the opt-in; nothing else produces these.
    if (ctx.source.kind === 'automation' && UPDATE_EVENTS.has(event.type)) {
      const payload = toNotificationPayload(event, ctx.source);
      return {
        kind: 'update',
        title: payload.title,
        body: payload.message,
        // The discriminator goes last: a payload key named `type` must never replace it.
        data: { ...event.payload, type: eventTypeOf(event) },
      };
    }
    if (ctx.source.kind !== 'automation') return { kind: 'event', event };
    const { automation } = toNotificationPayload(event, ctx.source);
    const override: PushOverride = {
      ...(automation?.title !== undefined && { title: automation.title }),
      ...(automation?.message !== undefined && { body: automation.message }),
    };
    return {
      kind: 'event',
      event,
      ...(Object.keys(override).length > 0 && { override }),
    };
  },
  async deliver(rendered) {
    if (rendered.kind === 'update') {
      return pushNotificationService.notifyUpdate(rendered.title, rendered.body, rendered.data);
    }
    const e = rendered.event;
    const override = rendered.override;
    switch (e.type) {
      case 'violation':
        return pushNotificationService.notifyViolation(e.payload, override);
      case 'session_started':
        return pushNotificationService.notifySessionStarted(e.payload, override);
      case 'session_stopped':
        return pushNotificationService.notifySessionStopped(e.payload, override);
      case 'server_down':
        return pushNotificationService.notifyServerDown(
          e.payload.serverName,
          e.payload.serverId,
          override
        );
      case 'server_up':
        return pushNotificationService.notifyServerUp(
          e.payload.serverName,
          e.payload.serverId,
          override
        );
      case 'plugin_update_available':
      case 'server_update_available':
      case 'tracearr_update_available':
        return; // an automation routes these as an update render; a system source has nowhere to go
    }
  },
  test: async () => {
    // no config to test; the route returns 400 for built-ins
  },
};
