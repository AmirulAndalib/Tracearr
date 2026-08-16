/**
 * Account inactivity evaluation. Called by the hourly inactivity check job
 * (jobs/inactivityCheckQueue.ts), not during session evaluation.
 */

import {
  type AccountInactivityParams,
  type Operator,
  type ServerUser,
  type ViolationSeverity,
  TIME_MS,
} from '@tracearr/shared';

export interface AccountInactivityResult {
  violated: boolean;
  severity: ViolationSeverity;
  data: Record<string, unknown>;
}

function convertToThresholdDays(params: AccountInactivityParams): number {
  switch (params.inactivityUnit) {
    case 'days':
      return params.inactivityValue;
    case 'weeks':
      return params.inactivityValue * 7;
    case 'months':
      return params.inactivityValue * 30;
    default:
      return params.inactivityValue;
  }
}

// Near-duplicate of compare() in ./comparisons.ts, except the default branch is
// `>=` here and `false` there; merging the two is phase-2 work, skipped here.
function compareNumeric(actual: number, operator: Operator, expected: number): boolean {
  switch (operator) {
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'gt':
      return actual > expected;
    case 'gte':
      return actual >= expected;
    case 'lt':
      return actual < expected;
    case 'lte':
      return actual <= expected;
    default:
      return actual >= expected;
  }
}

export function evaluateAccountInactivity(
  serverUser: Pick<ServerUser, 'username' | 'lastActivityAt'>,
  params: AccountInactivityParams,
  operator: Operator = 'gte'
): AccountInactivityResult {
  const now = Date.now();
  const thresholdDays = convertToThresholdDays(params);

  if (!serverUser.lastActivityAt) {
    // "Never active" users have infinite inactivity — matches gte/gt/neq but NOT eq/lt/lte
    const neverActiveMatches = operator === 'gte' || operator === 'gt' || operator === 'neq';
    if (!neverActiveMatches) {
      return { violated: false, severity: 'low', data: {} };
    }
    return {
      violated: true,
      severity: 'low',
      data: {
        lastActivityAt: null,
        inactiveDays: null,
        thresholdDays,
        username: serverUser.username,
        neverActive: true,
      },
    };
  }

  const lastActivityTime = serverUser.lastActivityAt.getTime();
  const inactiveDurationMs = now - lastActivityTime;
  const inactiveDays = Math.floor(inactiveDurationMs / TIME_MS.DAY);

  const violated = compareNumeric(inactiveDays, operator, thresholdDays);

  if (violated) {
    return {
      violated: true,
      severity: 'low',
      data: {
        lastActivityAt: serverUser.lastActivityAt.toISOString(),
        inactiveDays,
        thresholdDays,
        username: serverUser.username,
        neverActive: false,
      },
    };
  }

  return { violated: false, severity: 'low', data: {} };
}
