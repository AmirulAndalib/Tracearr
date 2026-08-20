import { z } from 'zod';
import {
  crossServerEnforcementRefinement,
  hasAtMostOneScope,
  ruleActionsSchema,
  ruleConditionsSchema,
  scopeAllowsCrossServerEnforcement,
  scopeRefinement,
  uuidSchema,
  violationSeveritySchema,
} from './schemas.js';
import type { RuleActions, RuleConditions, ViolationSeverity } from './types.js';

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
  serverId: string;
  subjectKey: string | null;
  startedAt: string;
  finishedAt: string | null;
  acknowledgedAt: string | null;
  dismissedAt: string | null;
}

export interface AutomationRun extends AutomationRunSummary {
  /** Ordered step log; step zero is the trigger payload. */
  steps: unknown[];
  definitionVersionId: string | null;
}
