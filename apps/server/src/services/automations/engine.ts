import { INACTIVITY_COMPATIBLE_FIELDS } from '@tracearr/shared';
import type {
  AutomationConditions,
  ConditionGroup,
  Condition,
  ConditionField,
  EngineAutomation,
  ConditionEvidence,
  GroupEvidence,
} from '@tracearr/shared';
import type {
  AccountConditionEvaluator,
  EvaluationContext,
  EvaluationResult,
  ConditionEvaluator,
  EvaluatorResult,
  SessionEvaluationContext,
} from './types.js';
import { evaluatorRegistry } from './evaluators/index.js';
import { rulesLogger as logger } from '../../utils/logger.js';

/**
 * Convert an evaluator result to condition evidence.
 */
function toConditionEvidence(condition: Condition, result: EvaluatorResult): ConditionEvidence {
  const evidence: ConditionEvidence = {
    field: condition.field,
    operator: condition.operator,
    threshold: condition.value,
    actual: result.actual,
    matched: result.matched,
  };
  if (result.relatedSessionIds?.length) {
    evidence.relatedSessionIds = result.relatedSessionIds;
  }
  if (result.details && Object.keys(result.details).length > 0) {
    evidence.details = result.details;
  }
  return evidence;
}

interface GroupResult {
  matched: boolean;
  conditions: ConditionEvidence[];
}

interface AllGroupsResult {
  matchedGroups: number[] | null;
  evidence: GroupEvidence[];
}

const ACCOUNT_CONDITION_FIELDS: ReadonlySet<ConditionField> = new Set(INACTIVITY_COMPATIBLE_FIELDS);

function unmatchedEvidence(condition: Condition): ConditionEvidence {
  return {
    field: condition.field,
    operator: condition.operator,
    threshold: condition.value,
    actual: null,
    matched: false,
  };
}

/**
 * Evaluate a single condition and return evidence. Awaits the evaluator's
 * result whether it resolves synchronously or via a Promise.
 */
async function evaluateConditionAsync(
  context: EvaluationContext,
  condition: Condition
): Promise<ConditionEvidence> {
  const evaluator: ConditionEvaluator | AccountConditionEvaluator | undefined =
    evaluatorRegistry[condition.field];

  if (!evaluator) {
    logger.warn(`No evaluator found for condition field: ${condition.field}`, {
      field: condition.field,
    });
    return unmatchedEvidence(condition);
  }

  try {
    if (context.session === null) {
      if (!ACCOUNT_CONDITION_FIELDS.has(condition.field)) return unmatchedEvidence(condition);
      const result = (evaluator as AccountConditionEvaluator)(context, condition);
      const resolved = result instanceof Promise ? await result : result;
      return toConditionEvidence(condition, resolved);
    }
    const result = evaluator(context as SessionEvaluationContext, condition);
    // Handle both sync and async evaluators
    const resolved = result instanceof Promise ? await result : result;
    return toConditionEvidence(condition, resolved);
  } catch (error) {
    logger.error(`Error evaluating condition field ${condition.field}`, {
      field: condition.field,
      error,
    });
    return unmatchedEvidence(condition);
  }
}

/**
 * Evaluate a condition group (conditions within a group are OR'd).
 * Evaluates ALL conditions in parallel to collect full evidence.
 */
async function evaluateConditionGroupAsync(
  context: EvaluationContext,
  group: ConditionGroup
): Promise<GroupResult> {
  if (group.conditions.length === 0) {
    return { matched: true, conditions: [] };
  }

  // Evaluate all conditions in parallel, collecting full evidence
  const conditions = await Promise.all(
    group.conditions.map((condition) => evaluateConditionAsync(context, condition))
  );

  return { matched: conditions.some((c) => c.matched), conditions };
}

/**
 * Evaluate all condition groups (groups are AND'd together).
 * Returns evidence for all evaluated groups.
 */
async function evaluateAllGroupsAsync(
  context: EvaluationContext,
  conditions: AutomationConditions
): Promise<AllGroupsResult> {
  if (conditions.groups.length === 0) {
    return { matchedGroups: [], evidence: [] };
  }

  const matchedGroups: number[] = [];
  const evidence: GroupEvidence[] = [];

  // Evaluate groups sequentially (AND logic requires early exit on failure)
  for (let i = 0; i < conditions.groups.length; i++) {
    const group = conditions.groups[i];
    if (!group) continue;

    const groupResult = await evaluateConditionGroupAsync(context, group);
    evidence.push({
      groupIndex: i,
      matched: groupResult.matched,
      conditions: groupResult.conditions,
    });

    if (!groupResult.matched) {
      return { matchedGroups: null, evidence };
    }
    matchedGroups.push(i);
  }

  return { matchedGroups, evidence };
}

/**
 * Evaluate a single rule against the given context.
 */
export async function evaluateRuleAsync(context: EvaluationContext): Promise<EvaluationResult> {
  const { rule } = context;

  if (!rule.conditions?.groups) {
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      matched: false,
      matchedGroups: [],
      actions: [],
    };
  }

  const { matchedGroups, evidence } = await evaluateAllGroupsAsync(context, rule.conditions);
  const matched = matchedGroups !== null;
  const stoppedBy = matched ? undefined : evidence[evidence.length - 1];

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    matched,
    matchedGroups: matchedGroups ?? [],
    actions: matched ? (rule.actions?.actions ?? []) : [],
    evidence: matched ? evidence : undefined,
    ...(stoppedBy ? { stoppedBy } : {}),
  };
}

/** The scope filters that decide whether a rule is evaluated at all. */
export function ruleAppliesTo(
  rule: EngineAutomation,
  baseContext: Omit<EvaluationContext, 'rule'>
): boolean {
  if (!rule.isActive) return false;
  if (rule.serverId && rule.serverId !== baseContext.server.id) return false;
  if (rule.serverUserId && rule.serverUserId !== baseContext.serverUser.id) return false;
  if (rule.userId && rule.userId !== baseContext.serverUser.userId) return false;
  return true;
}

/**
 * Evaluate multiple rules against the given session context.
 * Returns matching rules with their actions, or every evaluated rule when the
 * caller records a run per evaluation rather than per match.
 */
export async function evaluateRulesAsync(
  baseContext: Omit<EvaluationContext, 'rule'>,
  rules: EngineAutomation[],
  opts: { includeUnmatched?: boolean } = {}
): Promise<EvaluationResult[]> {
  const results: EvaluationResult[] = [];

  for (const rule of rules) {
    if (!ruleAppliesTo(rule, baseContext)) {
      continue;
    }

    const context: EvaluationContext = {
      ...baseContext,
      rule,
    };

    const result = await evaluateRuleAsync(context);

    if (result.matched || opts.includeUnmatched) {
      results.push(result);
    }
  }

  return results;
}
