import { DESTINATION_TYPES, WS_EVENTS, type NotificationToast } from '@tracearr/shared';
import { getPubSubService } from '../../cache.js';
import { toNotificationPayload } from '../types.js';
import type { NotificationEvent, NotificationSource } from '../events.js';
import type { DestinationType } from './types.js';

export interface ToastRendered {
  /** The data emit the browser's health banner reads; independent of any toast. */
  server?: {
    event: typeof WS_EVENTS.SERVER_DOWN | typeof WS_EVENTS.SERVER_UP;
    data: { serverId: string; serverName: string };
  };
  toast?: NotificationToast;
}

/** The automation is the gate: only its own sends toast, and every event type does. */
function toastFor(event: NotificationEvent, source: NotificationSource): NotificationToast | null {
  if (source.kind === 'rule') {
    // Pre-automation jobs still in the queue at upgrade; only ever violation-shaped.
    if (event.type !== 'violation') return null;
    return {
      title: source.title,
      message: source.message,
      automationId: event.payload.rule.id,
      automationName: event.payload.rule.name,
      severity: event.payload.severity,
    };
  }
  if (source.kind !== 'automation') return null;
  const payload = toNotificationPayload(event, source);
  return {
    title: payload.title,
    message: payload.message,
    automationId: source.automationId,
    automationName: source.automationName,
    severity: payload.severity,
  };
}

export const webToastType: DestinationType<Record<string, never>, ToastRendered> = {
  kind: 'web_toast',
  events: DESTINATION_TYPES.web_toast.events,
  render(event, _config, ctx) {
    const toast = toastFor(event, ctx.source);
    const server =
      event.type === 'server_down'
        ? { event: WS_EVENTS.SERVER_DOWN, data: event.payload }
        : event.type === 'server_up'
          ? { event: WS_EVENTS.SERVER_UP, data: event.payload }
          : undefined;
    return { ...(server && { server }), ...(toast && { toast }) };
  },
  async deliver(rendered) {
    if (!rendered.server && !rendered.toast) return;
    const pubSub = getPubSubService();
    if (!pubSub) throw new Error('pub/sub unavailable');
    if (rendered.server) await pubSub.publish(rendered.server.event, rendered.server.data);
    if (rendered.toast) await pubSub.publish(WS_EVENTS.NOTIFICATION_TOAST, rendered.toast);
  },
  test: async () => {
    // no config to test; the route returns 400 for built-ins
  },
};
