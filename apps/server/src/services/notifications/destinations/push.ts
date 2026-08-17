import { DESTINATION_TYPES } from '@tracearr/shared';
import { pushNotificationService } from '../../pushNotification.js';
import type { NotificationEvent } from '../events.js';
import type { DestinationType } from './types.js';

export type PushRendered =
  | { kind: 'rule'; title: string; message: string; data: Record<string, unknown> }
  | { kind: 'system'; event: NotificationEvent };

export const pushType: DestinationType<Record<string, never>, PushRendered> = {
  kind: 'push',
  events: DESTINATION_TYPES.push.events,
  render(event, _config, ctx) {
    if (ctx.source.kind === 'rule' && event.type === 'violation') {
      const v = event.payload;
      // notifyRuleDirect reads serverId/thumbPath/userThumbUrl for the image; the executor puts them in data
      return {
        kind: 'rule',
        title: ctx.source.title,
        message: ctx.source.message,
        data: { ruleId: v.rule.id, ruleName: v.rule.name, ...(v.data ?? {}) },
      };
    }
    return { kind: 'system', event };
  },
  async deliver(rendered) {
    if (rendered.kind === 'rule') {
      await pushNotificationService.notifyRuleDirect(
        rendered.title,
        rendered.message,
        rendered.data
      );
      return;
    }
    const e = rendered.event;
    switch (e.type) {
      case 'violation':
        return pushNotificationService.notifyViolation(e.payload);
      case 'session_started':
        return pushNotificationService.notifySessionStarted(e.payload);
      case 'session_stopped':
        return pushNotificationService.notifySessionStopped(e.payload);
      case 'server_down':
        return pushNotificationService.notifyServerDown(e.payload.serverName, e.payload.serverId);
      case 'server_up':
        return pushNotificationService.notifyServerUp(e.payload.serverName, e.payload.serverId);
      case 'plugin_update_available':
        return; // not subscribable; kept exhaustive
    }
  },
  test: async () => {
    // no config to test; the route returns 400 for built-ins
  },
};
