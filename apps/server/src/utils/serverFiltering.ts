/**
 * Server filtering utilities for multi-server access control
 *
 * These utilities help enforce server-level access control across API routes.
 * Users can only see data from servers they have access to (listed in serverIds).
 * Owners bypass server filtering and see all servers.
 */

import { sql, inArray, eq, type SQL, type Column } from 'drizzle-orm';
import type { AuthUser } from '@tracearr/shared';

/**
 * Build a SQL condition for filtering by server access.
 *
 * @param authUser - The authenticated user with serverIds array
 * @param serverIdColumn - The column to filter on (e.g., sessions.serverId)
 * @returns SQL condition or undefined (owners see all)
 *
 * @example
 * ```ts
 * const serverCondition = buildServerAccessCondition(authUser, sessions.serverId);
 * if (serverCondition) {
 *   conditions.push(serverCondition);
 * }
 * ```
 */
export function buildServerAccessCondition(
  authUser: AuthUser,
  serverIdColumn: Column
): SQL | undefined {
  // Owners see all servers
  if (authUser.role === 'owner') {
    return undefined;
  }

  // No server access - return impossible condition
  if (authUser.serverIds.length === 0) {
    return sql`false`;
  }

  // Single server - use equality for simpler query plan
  if (authUser.serverIds.length === 1) {
    return eq(serverIdColumn, authUser.serverIds[0]);
  }

  // Multiple servers - use IN clause
  return inArray(serverIdColumn, authUser.serverIds);
}

/**
 * Build a SQL condition for an explicit serverId filter parameter.
 * Also validates that the user has access to the requested server.
 *
 * @param authUser - The authenticated user
 * @param serverId - The requested server ID (from query params)
 * @param serverIdColumn - The column to filter on
 * @returns Object with condition and error (if access denied)
 *
 * @example
 * ```ts
 * const { condition, error } = buildServerFilterCondition(authUser, serverId, sessions.serverId);
 * if (error) {
 *   return reply.forbidden(error);
 * }
 * if (condition) {
 *   conditions.push(condition);
 * }
 * ```
 */
export function buildServerFilterCondition(
  authUser: AuthUser,
  serverId: string | undefined,
  serverIdColumn: Column
): { condition: SQL | undefined; error: string | null } {
  // If explicit serverId requested, validate access
  if (serverId) {
    if (authUser.role !== 'owner' && !authUser.serverIds.includes(serverId)) {
      return {
        condition: undefined,
        error: 'You do not have access to this server',
      };
    }
    // User has access, filter to specific server
    return {
      condition: eq(serverIdColumn, serverId),
      error: null,
    };
  }

  // No explicit serverId - apply user's server access filter
  return {
    condition: buildServerAccessCondition(authUser, serverIdColumn),
    error: null,
  };
}

/**
 * Filter an array of items by server access.
 * Use this for post-query filtering when the query can't be easily modified.
 *
 * @param items - Array of items with serverId property
 * @param authUser - The authenticated user
 * @returns Filtered array containing only accessible items
 *
 * @example
 * ```ts
 * const allSessions = await cache.getActiveSessions();
 * const userSessions = filterByServerAccess(allSessions, authUser);
 * ```
 */
export function filterByServerAccess<T extends { serverId: string }>(
  items: T[],
  authUser: AuthUser
): T[] {
  // Owners see all
  if (authUser.role === 'owner') {
    return items;
  }

  // Filter by accessible servers
  return items.filter((item) => authUser.serverIds.includes(item.serverId));
}

/**
 * Check if user has access to a specific server.
 *
 * @param authUser - The authenticated user
 * @param serverId - The server ID to check
 * @returns true if user has access
 */
export function hasServerAccess(authUser: AuthUser, serverId: string): boolean {
  return authUser.role === 'owner' || authUser.serverIds.includes(serverId);
}

/**
 * Validate server access and return error message if denied.
 * Convenience function for route handlers.
 *
 * @param authUser - The authenticated user
 * @param serverId - The server ID to validate
 * @returns Error message or null if access granted
 *
 * @example
 * ```ts
 * const error = validateServerAccess(authUser, serverId);
 * if (error) {
 *   return reply.forbidden(error);
 * }
 * ```
 */
export function validateServerAccess(authUser: AuthUser, serverId: string): string | null {
  if (hasServerAccess(authUser, serverId)) {
    return null;
  }
  return 'You do not have access to this server';
}
