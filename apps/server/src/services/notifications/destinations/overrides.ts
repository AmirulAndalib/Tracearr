import type { NotificationPayload } from '../types.js';

/** The automation's rendered text wins over the kind's builtin copy, field by field. */
export function textOf(
  payload: NotificationPayload,
  defaults: { title: string; message: string }
): { title: string; message: string } {
  return {
    title: payload.automation?.title ?? defaults.title,
    message: payload.automation?.message ?? defaults.message,
  };
}
