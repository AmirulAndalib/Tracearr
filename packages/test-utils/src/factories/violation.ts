/**
 * Violation factory for test data generation
 *
 * Creates violation records when rules are triggered.
 */

import { executeRawSql } from '../db/pool.js';

export type ViolationSeverity = 'low' | 'warning' | 'high';

export interface ViolationData {
  id?: string;
  ruleId: string;
  serverUserId: string;
  sessionId: string;
  severity?: ViolationSeverity;
  data?: Record<string, unknown>;
  acknowledgedAt?: Date | null;
}

export interface CreatedViolation {
  id: string;
  ruleId: string;
  serverUserId: string;
  sessionId: string;
  severity: ViolationSeverity;
  data: Record<string, unknown>;
  createdAt: Date;
  acknowledgedAt: Date | null;
}

let violationCounter = 0;

/**
 * Generate unique violation data with defaults
 */
export function buildViolation(overrides: ViolationData): Required<ViolationData> {
  violationCounter++;
  // Counter used for predictable test ordering when resetViolationCounter() is called
  void violationCounter;

  return {
    id: overrides.id ?? crypto.randomUUID(),
    ruleId: overrides.ruleId,
    serverUserId: overrides.serverUserId,
    sessionId: overrides.sessionId,
    severity: overrides.severity ?? 'warning',
    data: overrides.data ?? {},
    acknowledgedAt: overrides.acknowledgedAt ?? null,
  };
}

/**
 * Create a violation in the database
 */
export async function createTestViolation(data: ViolationData): Promise<CreatedViolation> {
  const fullData = buildViolation(data);

  const result = await executeRawSql(`
    INSERT INTO automation_runs (id, rule_id, server_user_id, session_id, severity, data, acknowledged_at)
    VALUES (
      '${fullData.id}',
      '${fullData.ruleId}',
      '${fullData.serverUserId}',
      '${fullData.sessionId}',
      '${fullData.severity}',
      '${JSON.stringify(fullData.data)}'::jsonb,
      ${fullData.acknowledgedAt ? `'${fullData.acknowledgedAt.toISOString()}'` : 'NULL'}
    )
    RETURNING *
  `);

  return mapViolationRow(result.rows[0]);
}

/**
 * Create a low severity violation
 */
export async function createLowViolation(data: ViolationData): Promise<CreatedViolation> {
  return createTestViolation({
    severity: 'low',
    ...data,
  });
}

/**
 * Create a warning severity violation
 */
export async function createWarningViolation(data: ViolationData): Promise<CreatedViolation> {
  return createTestViolation({
    severity: 'warning',
    ...data,
  });
}

/**
 * Create a high severity violation
 */
export async function createHighViolation(data: ViolationData): Promise<CreatedViolation> {
  return createTestViolation({
    severity: 'high',
    ...data,
  });
}

/**
 * Create an acknowledged violation
 */
export async function createAcknowledgedViolation(data: ViolationData): Promise<CreatedViolation> {
  return createTestViolation({
    acknowledgedAt: new Date(),
    ...data,
  });
}

/**
 * Create violation with impossible travel data
 */
export async function createImpossibleTravelViolation(
  data: ViolationData,
  details: { from_city: string; to_city: string; speed_kmh: number; time_diff_minutes: number }
): Promise<CreatedViolation> {
  return createTestViolation({
    ...data,
    severity: 'high',
    data: {
      type: 'impossible_travel',
      ...details,
    },
  });
}

/**
 * Create violation with concurrent streams data
 */
export async function createConcurrentStreamsViolation(
  data: ViolationData,
  details: { stream_count: number; max_allowed: number; devices: string[] }
): Promise<CreatedViolation> {
  return createTestViolation({
    ...data,
    severity: 'warning',
    data: {
      type: 'concurrent_streams',
      ...details,
    },
  });
}

/**
 * Map database row to typed violation object
 */
function mapViolationRow(row: Record<string, unknown>): CreatedViolation {
  return {
    id: row.id as string,
    ruleId: row.rule_id as string,
    serverUserId: row.server_user_id as string,
    sessionId: row.session_id as string,
    severity: row.severity as ViolationSeverity,
    data: row.data as Record<string, unknown>,
    createdAt: row.created_at as Date,
    acknowledgedAt: row.acknowledged_at as Date | null,
  };
}

/**
 * Reset violation counter
 */
export function resetViolationCounter(): void {
  violationCounter = 0;
}
