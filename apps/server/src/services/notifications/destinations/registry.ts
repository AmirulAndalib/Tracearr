import type { DestinationKind } from '@tracearr/shared';
import { appriseType } from './apprise.js';
import { discordType } from './discord.js';
import { gotifyType } from './gotify.js';
import { jsonWebhookType } from './jsonWebhook.js';
import { ntfyType } from './ntfy.js';
import type { DestinationType } from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry: Partial<Record<DestinationKind, DestinationType<any, any>>> = {
  discord: discordType,
  json_webhook: jsonWebhookType,
  ntfy: ntfyType,
  gotify: gotifyType,
  apprise: appriseType,
};

export function getDestinationType(
  kind: DestinationKind
): DestinationType<Record<string, unknown>, unknown> {
  const t = registry[kind];
  if (!t) throw new Error(`No destination type registered for ${kind}`);
  return t as DestinationType<Record<string, unknown>, unknown>;
}

export function registerDestinationType(type: DestinationType<never, unknown>): void {
  registry[type.kind] = type as DestinationType<unknown, unknown>;
}
