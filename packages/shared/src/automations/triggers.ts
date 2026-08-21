import { z } from 'zod';

export type TriggerContext = 'session' | 'account' | 'server' | 'install';

/** A context outranks another when it supplies everything the other does and more. */
export const TRIGGER_CONTEXT_RANK: Record<TriggerContext, number> = {
  session: 3,
  account: 2,
  server: 1,
  install: 0,
};

const SESSION_VARS = [
  'user.username',
  'user.identityName',
  'session.mediaTitle',
  'session.mediaType',
  'server.name',
  'server.type',
] as const;
const SERVER_VARS = ['server.name', 'server.type'] as const;

export const TRIGGERS = {
  'session.started': { context: 'session', group: 'sessions', variables: SESSION_VARS },
  'session.stopped': {
    context: 'session',
    group: 'sessions',
    variables: [...SESSION_VARS, 'durationMinutes'],
  },
  'session.transcode_changed': { context: 'session', group: 'sessions', variables: SESSION_VARS },
  'session.paused': { context: 'session', group: 'sessions', variables: SESSION_VARS },
  'session.held_for': {
    context: 'session',
    group: 'sessions',
    variables: [...SESSION_VARS, 'minutes'],
  },
  'account.inactive_for': {
    context: 'account',
    group: 'accounts',
    variables: ['user.username', 'user.identityName', 'server.name', 'server.type', 'days'],
  },
  'server.down': { context: 'server', group: 'servers', variables: SERVER_VARS },
  'server.up': { context: 'server', group: 'servers', variables: SERVER_VARS },
  'plugin.update_available': {
    context: 'server',
    group: 'updates',
    variables: [...SERVER_VARS, 'installedVersion', 'latestVersion', 'downloadUrl'],
  },
  'server.update_available': {
    context: 'server',
    group: 'updates',
    variables: [...SERVER_VARS, 'installedVersion', 'latestVersion', 'releaseUrl'],
  },
  'tracearr.update_available': {
    context: 'install',
    group: 'updates',
    variables: ['current', 'latest', 'releaseUrl'],
  },
} as const satisfies Record<
  string,
  {
    context: TriggerContext;
    group: 'sessions' | 'accounts' | 'servers' | 'updates';
    variables: readonly string[];
  }
>;

export type TriggerType = keyof typeof TRIGGERS;
export const TRIGGER_TYPES = Object.keys(TRIGGERS) as TriggerType[];

type ParamlessTriggerType = Exclude<TriggerType, 'session.held_for' | 'account.inactive_for'>;

const PARAMLESS_TRIGGER_TYPES = TRIGGER_TYPES.filter(
  (type): type is ParamlessTriggerType =>
    type !== 'session.held_for' && type !== 'account.inactive_for'
);

// z.uuid() rather than schemas.ts's uuidSchema: schemas.ts re-exports this directory's
// condition and action schemas, and importing back would read the binding before it exists.
const nodeBase = { id: z.uuid(), enabled: z.boolean() };

export const heldForParamsSchema = z.strictObject({
  minutes: z.number().int().min(1).max(1440),
  measure: z.enum(['current', 'total']),
});
export const inactiveForParamsSchema = z.strictObject({
  days: z.number().int().min(1).max(3650),
});

export const triggerNodeSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...nodeBase, type: z.enum(PARAMLESS_TRIGGER_TYPES) }),
  z.strictObject({ ...nodeBase, type: z.literal('session.held_for'), params: heldForParamsSchema }),
  z.strictObject({
    ...nodeBase,
    type: z.literal('account.inactive_for'),
    params: inactiveForParamsSchema,
  }),
]);
export type TriggerNode = z.infer<typeof triggerNodeSchema>;

/** The most demanding context every enabled trigger can satisfy; null when nothing is enabled. */
export function contextOf(triggers: readonly TriggerNode[]): TriggerContext | null {
  let min: TriggerContext | null = null;
  for (const trigger of triggers) {
    if (!trigger.enabled) continue;
    const context = TRIGGERS[trigger.type].context;
    if (min === null || TRIGGER_CONTEXT_RANK[context] < TRIGGER_CONTEXT_RANK[min]) min = context;
  }
  return min;
}

/** The variables every enabled trigger offers, so a template renders whichever one fired. */
export function variablesFor(triggers: readonly TriggerNode[]): string[] {
  const sets = triggers
    .filter((trigger) => trigger.enabled)
    .map((trigger) => new Set<string>(TRIGGERS[trigger.type].variables));
  const first = sets[0];
  if (!first) return [];
  return [...first].filter((variable) => sets.every((set) => set.has(variable)));
}
