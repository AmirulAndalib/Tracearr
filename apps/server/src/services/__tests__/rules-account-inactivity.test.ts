/**
 * Account Inactivity Rule Tests
 *
 * Tests the account_inactivity rule type that detects users who have been
 * inactive for a specified period.
 */

import { describe, it, expect } from 'vitest';
import { evaluateAccountInactivity } from '../rules/accountInactivity.js';
import type { AccountInactivityParams } from '@tracearr/shared';

describe('Account Inactivity', () => {
  // Helper to create a mock server user for inactivity checks
  const createMockServerUser = (
    overrides: {
      id?: string;
      username?: string;
      lastActivityAt?: Date | null;
    } = {}
  ): { id: string; username: string; lastActivityAt: Date | null } => ({
    id: overrides.id ?? 'user-123',
    username: overrides.username ?? 'testuser',
    // Use explicit check to preserve null values (null means never active)
    lastActivityAt:
      'lastActivityAt' in overrides ? (overrides.lastActivityAt as Date | null) : new Date(),
  });

  // Helper to create inactivity params
  const createInactivityParams = (
    overrides: Partial<AccountInactivityParams> = {}
  ): AccountInactivityParams => ({
    inactivityValue: 30,
    inactivityUnit: 'days',
    ...overrides,
  });

  describe('evaluateAccountInactivity', () => {
    describe('basic inactivity detection', () => {
      it('should not violate when user was recently active', () => {
        const user = createMockServerUser({
          lastActivityAt: new Date(), // Active now
        });
        const params = createInactivityParams({ inactivityValue: 30, inactivityUnit: 'days' });

        const result = evaluateAccountInactivity(user, params);

        expect(result.violated).toBe(false);
      });

      it('should violate when user has been inactive longer than threshold', () => {
        const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
        const user = createMockServerUser({
          lastActivityAt: thirtyOneDaysAgo,
        });
        const params = createInactivityParams({ inactivityValue: 30, inactivityUnit: 'days' });

        const result = evaluateAccountInactivity(user, params);

        expect(result.violated).toBe(true);
        expect(result.severity).toBe('low');
        expect(result.data.inactiveDays).toBeGreaterThanOrEqual(31);
        expect(result.data.thresholdDays).toBe(30);
        expect(result.data.neverActive).toBe(false);
      });

      it('should not violate when user activity is exactly at threshold', () => {
        // Exactly 30 days ago - should NOT violate (need to exceed threshold)
        const exactlyThirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 + 1000); // +1s to be just under
        const user = createMockServerUser({
          lastActivityAt: exactlyThirtyDaysAgo,
        });
        const params = createInactivityParams({ inactivityValue: 30, inactivityUnit: 'days' });

        const result = evaluateAccountInactivity(user, params);

        // Should not violate if exactly at 30 days or just under
        expect(result.violated).toBe(false);
      });
    });

    describe('time unit conversions', () => {
      it('should correctly calculate days threshold', () => {
        const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
        const user = createMockServerUser({ lastActivityAt: fifteenDaysAgo });

        // 14 days threshold - should violate (15 > 14)
        const result = evaluateAccountInactivity(
          user,
          createInactivityParams({
            inactivityValue: 14,
            inactivityUnit: 'days',
          })
        );

        expect(result.violated).toBe(true);
        expect(result.data.thresholdDays).toBe(14);
      });

      it('should correctly calculate weeks threshold', () => {
        const threeWeeksAgo = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
        const user = createMockServerUser({ lastActivityAt: threeWeeksAgo });

        // 2 weeks threshold - should violate (3 weeks > 2 weeks)
        const result = evaluateAccountInactivity(
          user,
          createInactivityParams({
            inactivityValue: 2,
            inactivityUnit: 'weeks',
          })
        );

        expect(result.violated).toBe(true);
        expect(result.data.thresholdDays).toBe(14); // 2 weeks = 14 days
      });

      it('should correctly calculate months threshold', () => {
        const twoMonthsAgo = new Date(Date.now() - 65 * 24 * 60 * 60 * 1000); // ~65 days
        const user = createMockServerUser({ lastActivityAt: twoMonthsAgo });

        // 2 months threshold (~60 days) - should violate
        const result = evaluateAccountInactivity(
          user,
          createInactivityParams({
            inactivityValue: 2,
            inactivityUnit: 'months',
          })
        );

        expect(result.violated).toBe(true);
        expect(result.data.thresholdDays).toBe(60); // 2 months = 60 days (30*2)
      });

      it('should not violate when within months threshold', () => {
        const fortyFiveDaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
        const user = createMockServerUser({ lastActivityAt: fortyFiveDaysAgo });

        // 2 months threshold (~60 days) - should not violate (45 < 60)
        const result = evaluateAccountInactivity(
          user,
          createInactivityParams({
            inactivityValue: 2,
            inactivityUnit: 'months',
          })
        );

        expect(result.violated).toBe(false);
      });
    });

    describe('users with no activity', () => {
      it('should violate for users who have never been active', () => {
        const user = createMockServerUser({
          lastActivityAt: null, // Never active
        });
        const params = createInactivityParams({ inactivityValue: 30, inactivityUnit: 'days' });

        const result = evaluateAccountInactivity(user, params);

        expect(result.violated).toBe(true);
        expect(result.data.neverActive).toBe(true);
        expect(result.data.lastActivityAt).toBeNull();
        expect(result.data.inactiveDays).toBeNull();
      });
    });

    describe('violation data structure', () => {
      it('should include all required data fields in violation', () => {
        const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        const user = createMockServerUser({
          username: 'inactive_user',
          lastActivityAt: sixtyDaysAgo,
        });
        const params = createInactivityParams({ inactivityValue: 30, inactivityUnit: 'days' });

        const result = evaluateAccountInactivity(user, params);

        expect(result.violated).toBe(true);
        expect(result.data).toMatchObject({
          username: 'inactive_user',
          thresholdDays: 30,
          neverActive: false,
        });
        expect(result.data.lastActivityAt).toBeDefined();
        expect(typeof result.data.inactiveDays).toBe('number');
      });

      it('should return ISO string for lastActivityAt', () => {
        const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
        const user = createMockServerUser({ lastActivityAt: thirtyOneDaysAgo });
        const params = createInactivityParams({ inactivityValue: 30, inactivityUnit: 'days' });

        const result = evaluateAccountInactivity(user, params);

        expect(typeof result.data.lastActivityAt).toBe('string');
        // Should be a valid ISO date string
        expect(() => new Date(result.data.lastActivityAt as string)).not.toThrow();
      });
    });

    describe('operator handling', () => {
      const thirtyDaysAgo = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 - 60000); // 30 days + 1 min
      const twentyNineDaysAgo = () => new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
      const sixtyDaysAgo = () => new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      const params30 = createInactivityParams({ inactivityValue: 30, inactivityUnit: 'days' });

      it('eq operator triggers only on the exact day', () => {
        // 30 days inactive — should match eq 30
        const user30 = createMockServerUser({ lastActivityAt: thirtyDaysAgo() });
        expect(evaluateAccountInactivity(user30, params30, 'eq').violated).toBe(true);

        // 29 days inactive — should NOT match eq 30
        const user29 = createMockServerUser({ lastActivityAt: twentyNineDaysAgo() });
        expect(evaluateAccountInactivity(user29, params30, 'eq').violated).toBe(false);

        // 60 days inactive — should NOT match eq 30
        const user60 = createMockServerUser({ lastActivityAt: sixtyDaysAgo() });
        expect(evaluateAccountInactivity(user60, params30, 'eq').violated).toBe(false);
      });

      it('gt operator triggers only after the threshold day', () => {
        const user30 = createMockServerUser({ lastActivityAt: thirtyDaysAgo() });
        expect(evaluateAccountInactivity(user30, params30, 'gt').violated).toBe(false);

        const user60 = createMockServerUser({ lastActivityAt: sixtyDaysAgo() });
        expect(evaluateAccountInactivity(user60, params30, 'gt').violated).toBe(true);
      });

      it('gte operator triggers on and after the threshold day', () => {
        const user29 = createMockServerUser({ lastActivityAt: twentyNineDaysAgo() });
        expect(evaluateAccountInactivity(user29, params30, 'gte').violated).toBe(false);

        const user30 = createMockServerUser({ lastActivityAt: thirtyDaysAgo() });
        expect(evaluateAccountInactivity(user30, params30, 'gte').violated).toBe(true);

        const user60 = createMockServerUser({ lastActivityAt: sixtyDaysAgo() });
        expect(evaluateAccountInactivity(user60, params30, 'gte').violated).toBe(true);
      });

      it('lt operator triggers only before the threshold day', () => {
        const user29 = createMockServerUser({ lastActivityAt: twentyNineDaysAgo() });
        expect(evaluateAccountInactivity(user29, params30, 'lt').violated).toBe(true);

        const user30 = createMockServerUser({ lastActivityAt: thirtyDaysAgo() });
        expect(evaluateAccountInactivity(user30, params30, 'lt').violated).toBe(false);
      });

      it('lte operator triggers on and before the threshold day', () => {
        const user30 = createMockServerUser({ lastActivityAt: thirtyDaysAgo() });
        expect(evaluateAccountInactivity(user30, params30, 'lte').violated).toBe(true);

        const user60 = createMockServerUser({ lastActivityAt: sixtyDaysAgo() });
        expect(evaluateAccountInactivity(user60, params30, 'lte').violated).toBe(false);
      });

      it('neq operator triggers on every day except the threshold', () => {
        const user29 = createMockServerUser({ lastActivityAt: twentyNineDaysAgo() });
        expect(evaluateAccountInactivity(user29, params30, 'neq').violated).toBe(true);

        const user30 = createMockServerUser({ lastActivityAt: thirtyDaysAgo() });
        expect(evaluateAccountInactivity(user30, params30, 'neq').violated).toBe(false);

        const user60 = createMockServerUser({ lastActivityAt: sixtyDaysAgo() });
        expect(evaluateAccountInactivity(user60, params30, 'neq').violated).toBe(true);
      });

      it('never-active users match gte/gt/neq but not eq/lt/lte', () => {
        const neverActive = createMockServerUser({ lastActivityAt: null });

        expect(evaluateAccountInactivity(neverActive, params30, 'gte').violated).toBe(true);
        expect(evaluateAccountInactivity(neverActive, params30, 'gt').violated).toBe(true);
        expect(evaluateAccountInactivity(neverActive, params30, 'neq').violated).toBe(true);
        expect(evaluateAccountInactivity(neverActive, params30, 'eq').violated).toBe(false);
        expect(evaluateAccountInactivity(neverActive, params30, 'lt').violated).toBe(false);
        expect(evaluateAccountInactivity(neverActive, params30, 'lte').violated).toBe(false);
      });

      it('defaults to gte when no operator is provided', () => {
        const user30 = createMockServerUser({ lastActivityAt: thirtyDaysAgo() });
        // No operator arg — should default to gte
        expect(evaluateAccountInactivity(user30, params30).violated).toBe(true);

        const user29 = createMockServerUser({ lastActivityAt: twentyNineDaysAgo() });
        expect(evaluateAccountInactivity(user29, params30).violated).toBe(false);
      });
    });

    describe('boundary conditions', () => {
      it('should handle very small inactivity values', () => {
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        const user = createMockServerUser({ lastActivityAt: twoDaysAgo });

        const result = evaluateAccountInactivity(
          user,
          createInactivityParams({
            inactivityValue: 1,
            inactivityUnit: 'days',
          })
        );

        expect(result.violated).toBe(true);
      });

      it('should handle very large inactivity values', () => {
        const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
        const user = createMockServerUser({ lastActivityAt: oneYearAgo });

        // 2 years threshold - should not violate
        const result = evaluateAccountInactivity(
          user,
          createInactivityParams({
            inactivityValue: 24,
            inactivityUnit: 'months',
          })
        );

        expect(result.violated).toBe(false);
      });

      it('should handle activity just moments ago', () => {
        const justNow = new Date(Date.now() - 1000); // 1 second ago
        const user = createMockServerUser({ lastActivityAt: justNow });

        const result = evaluateAccountInactivity(
          user,
          createInactivityParams({
            inactivityValue: 1,
            inactivityUnit: 'days',
          })
        );

        expect(result.violated).toBe(false);
      });
    });
  });
});
