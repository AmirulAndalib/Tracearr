import { z } from 'zod';
import { listDateBoundSchema, listSortSchema } from './listQuery.js';
import {
  booleanStringSchema,
  crossServerEnforcementRefinement,
  hasAtMostOneScope,
  paginationSchema,
  ruleActionsSchema,
  ruleConditionsSchema,
  type RuleActions,
  scopeAllowsCrossServerEnforcement,
  scopeRefinement,
  uuidSchema,
  violationSeveritySchema,
} from './schemas.js';
import type { RuleConditions, ViolationSeverity } from './types.js';

export const AUTOMATION_KINDS = ['policy', 'notification'] as const;
export type AutomationKind = (typeof AUTOMATION_KINDS)[number];

/** The five trigger types the engine subscribes for evaluation; the seam declares more, nothing else matches automations yet. */
export const TRIGGER_TYPES = [
  'session.started',
  'session.transcode_changed',
  'session.paused',
  'session.held_for',
  'account.inactive_for',
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const triggerNodeSchema = z.strictObject({
  id: uuidSchema,
  type: z.enum(TRIGGER_TYPES),
  enabled: z.boolean(),
});
export type TriggerNode = z.infer<typeof triggerNodeSchema>;

export const RUN_STATUSES = ['running', 'finished'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
// 'error' belongs to a run that failed before its terminal write; a bookkeeping failure
// after that write notes itself in steps rather than demoting the row.
export const RUN_OUTCOMES = ['completed', 'stopped_by_condition', 'error'] as const;
export type RunOutcome = (typeof RUN_OUTCOMES)[number];

/** Days a completed run survives when its automation names no retention of its own. */
export const RETENTION_DEFAULTS = {
  policy: 365,
  notification: 30,
} as const satisfies Record<AutomationKind, number>;

const automationFieldsSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  kind: z.enum(AUTOMATION_KINDS),
  severity: violationSeveritySchema.nullable(),
  conditions: ruleConditionsSchema,
  actions: ruleActionsSchema,
  serverId: uuidSchema.nullable().optional(),
  serverUserId: uuidSchema.nullable().optional(),
  userId: uuidSchema.nullable().optional(),
  enforceAcrossServers: z.boolean().optional(),
  cooldownMinutes: z.number().int().min(0).nullable().optional(),
  retentionDays: z.number().int().min(1).max(3650).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const createAutomationSchema = automationFieldsSchema
  .refine(hasAtMostOneScope, scopeRefinement)
  .refine(scopeAllowsCrossServerEnforcement, crossServerEnforcementRefinement);

export const updateAutomationSchema = automationFieldsSchema
  .partial()
  .refine(hasAtMostOneScope, scopeRefinement)
  .refine(scopeAllowsCrossServerEnforcement, crossServerEnforcementRefinement);

export type CreateAutomationInput = z.infer<typeof createAutomationSchema>;
export type UpdateAutomationInput = z.infer<typeof updateAutomationSchema>;

export const AUTOMATION_SORT_FIELDS = [
  'name',
  'createdAt',
  'updatedAt',
  'kind',
  'isActive',
] as const;
export type AutomationSortField = (typeof AUTOMATION_SORT_FIELDS)[number];

export const automationListQuerySchema = paginationSchema
  .extend({
    kind: z.enum(AUTOMATION_KINDS).optional(),
    enabled: booleanStringSchema.optional(),
    search: z.string().trim().min(1).max(100).optional(),
  })
  .extend(listSortSchema(AUTOMATION_SORT_FIELDS).shape);
export type AutomationListQuery = z.infer<typeof automationListQuerySchema>;

export const RUN_SORT_FIELDS = ['startedAt', 'finishedAt', 'outcome'] as const;
export type RunSortField = (typeof RUN_SORT_FIELDS)[number];

export const runListQuerySchema = paginationSchema
  .extend({
    kind: z.enum(AUTOMATION_KINDS).optional(),
    outcome: z.enum(RUN_OUTCOMES).optional(),
    automationId: uuidSchema.optional(),
    // Calendar days against the run's start, resolved to half-open UTC bounds.
    startDate: listDateBoundSchema,
    endDate: listDateBoundSchema,
  })
  .extend(listSortSchema(RUN_SORT_FIELDS).shape);
export type RunListQuery = z.infer<typeof runListQuerySchema>;

export const NEAR_MISS_REASONS = ['cooldown_active', 'edge_replayed', 'gate_blocked'] as const;
export type NearMissReason = (typeof NEAR_MISS_REASONS)[number];

/** One entry of the capped ring: a trigger matched but the pipeline recorded no run. */
export const nearMissEntrySchema = z.object({
  reason: z.enum(NEAR_MISS_REASONS),
  at: z.iso.datetime(),
  subjectKey: z.string(),
  trigger: z.string(),
});
export type NearMissEntry = z.infer<typeof nearMissEntrySchema>;

/** API shape. Dates are ISO strings; `triggers` is what the engine matches on. */
export interface Automation {
  id: string;
  name: string;
  description: string | null;
  kind: AutomationKind;
  severity: ViolationSeverity | null;
  triggers: TriggerNode[];
  conditions: RuleConditions;
  actions: RuleActions;
  serverId: string | null;
  serverUserId: string | null;
  userId: string | null;
  enforceAcrossServers: boolean;
  isActive: boolean;
  cooldownMinutes: number | null;
  /** null falls back to the kind's default retention */
  retentionDays: number | null;
  /** Name behind a person scope. The list never joins for it and always sends null. */
  identityName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRunSummary {
  id: string;
  automationId: string;
  automationName: string;
  kind: AutomationKind;
  status: RunStatus;
  outcome: RunOutcome;
  humanSummary: string | null;
  severity: ViolationSeverity | null;
  serverUserId: string | null;
  sessionId: string | null;
  /** Null only for a run with no server account to attribute it to. */
  serverId: string | null;
  subjectKey: string | null;
  startedAt: string;
  finishedAt: string | null;
  acknowledgedAt: string | null;
  dismissedAt: string | null;
}

/**
 * The socket payload for finished runs. Clients only refetch on it, so it names
 * which lists went stale and nothing else: the frame reaches every viewer in the
 * sessions room, and a run summary carries subject keys and stop reasons.
 */
export interface RunFinishedEvent {
  id: string;
  automationId: string;
  kind: AutomationKind;
  outcome: RunOutcome;
}

export interface AutomationRun extends AutomationRunSummary {
  /** Ordered step log; step zero is the trigger payload. */
  steps: unknown[];
  definitionVersionId: string | null;
}
