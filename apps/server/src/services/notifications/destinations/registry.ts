import type { DestinationKind } from '@tracearr/shared';
import { discordType } from './discord.js';
import type { DestinationType } from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry: Partial<Record<DestinationKind, DestinationType<any, any>>> = {
  discord: discordType,
};

export function getDestinationType(
  kind: DestinationKind
): DestinationType<Record<string, unknown>, unknown> {
  const t = registry[kind];
  if (!t) throw new Error(`No destination type registered for ${kind}`);
  return t as DestinationType<Record<string, unknown>, unknown>;
}

export function registerDestinationType(type: DestinationType<never, unknown>): void {
  registry[type.kind as DestinationKind] = type as DestinationType<unknown, unknown>;
}
