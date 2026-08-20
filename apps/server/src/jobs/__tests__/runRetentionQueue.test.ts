/**
 * Run Retention Queue Tests
 *
 * Pins the three delete predicates the daily purge renders: completed runs per
 * kind with the per-automation override, non-completed runs on the flat
 * diagnostic window, and the session-bound/finished guard shared by all three.
 * Row-level behavior lives in test/integration/runRetention.integration.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AUTOMATION_KINDS } from '@tracearr/shared';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('../../db/client.js', () => ({
  db: {
    execute: vi.fn(),
  },
}));

import { db } from '../../db/client.js';
import { processRunRetention } from '../runRetentionQueue.js';

const mockDb = db as unknown as { execute: ReturnType<typeof vi.fn> };
const dialect = new PgDialect();

interface RenderedQuery {
  sql: string;
  params: unknown[];
}

function rendered(): RenderedQuery[] {
  return mockDb.execute.mock.calls.map((call) => {
    const query = dialect.sqlToQuery(call[0] as SQL);
    return { sql: query.sql.replace(/\s+/g, ' ').toLowerCase(), params: query.params };
  });
}

describe('processRunRetention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.execute.mockResolvedValue({ rowCount: 0 });
  });

  it('purges completed runs per kind and non-completed runs on the flat window', async () => {
    await processRunRetention();

    const queries = rendered();
    expect(queries).toHaveLength(4);

    const [notification, policy, ...diagnostics] = queries;
    expect(notification?.sql).toContain("ar.kind = $1 and ar.outcome = 'completed'");
    expect(notification?.params).toEqual(['notification', 30, 5000]);

    expect(policy?.sql).toContain("ar.kind = $1 and ar.outcome = 'completed'");
    expect(policy?.params).toEqual(['policy', 365, 5000]);

    // Both kinds get the same flat diagnostic window; the split only keeps the index usable.
    expect(diagnostics).toHaveLength(2);
    for (const query of diagnostics) {
      expect(query.sql).toContain("ar.outcome <> 'completed'");
      expect(query.params.slice(1)).toEqual([30, 5000]);
    }
    expect(diagnostics.map((query) => query.params[0]).sort()).toEqual(
      [...AUTOMATION_KINDS].sort()
    );
  });

  it('takes the retention window from the joined automation, defaulting per kind', async () => {
    await processRunRetention();

    const [notification, policy, ...diagnostics] = rendered();
    for (const query of [notification, policy]) {
      expect(query?.sql).toContain('join automations a on a.id = ar.rule_id');
      expect(query?.sql).toContain(
        'ar.finished_at < now() - make_interval(days => coalesce(a.retention_days, $2))'
      );
    }
    // Diagnostics ignore the override entirely.
    for (const query of diagnostics) {
      expect(query.sql).not.toContain('coalesce');
      expect(query.sql).toContain('ar.finished_at < now() - make_interval(days => $2)');
    }
  });

  it('keeps every predicate session bound, finished, and blind to ack or dismiss', async () => {
    await processRunRetention();

    const queries = rendered();
    expect(queries).toHaveLength(4);
    for (const query of queries) {
      expect(query.sql).toContain("ar.status = 'finished'");
      expect(query.sql).toContain('ar.session_id is not null');
      expect(query.sql).not.toContain('acknowledged_at');
      expect(query.sql).not.toContain('dismissed_at');
    }
  });

  it('deletes in batches of 5000 until a short batch ends the pass', async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rowCount: 5000 })
      .mockResolvedValueOnce({ rowCount: 17 })
      .mockResolvedValue({ rowCount: 0 });

    const result = await processRunRetention();

    // Two calls to drain the notification pass, one each for the three that follow.
    expect(mockDb.execute).toHaveBeenCalledTimes(5);
    expect(result.notificationPurged).toBe(5017);
    for (const query of rendered()) {
      expect(query.sql).toContain('limit $');
      expect(query.params.at(-1)).toBe(5000);
    }
  });

  it('counts each pass separately and sums the diagnostic sweeps', async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rowCount: 3 })
      .mockResolvedValueOnce({ rowCount: 7 })
      .mockResolvedValueOnce({ rowCount: 11 })
      .mockResolvedValueOnce({ rowCount: 4 });

    const result = await processRunRetention();

    expect(result).toEqual({ notificationPurged: 3, policyPurged: 7, diagnosticPurged: 15 });
  });
});
