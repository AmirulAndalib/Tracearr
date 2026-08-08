/**
 * Live Plex server stats (CPU/RAM and bandwidth) behind a short Redis cache,
 * so concurrent dashboard viewers cost one Plex call per tick instead of one
 * each. Resources and bandwidth cache separately because the bandwidth TTL
 * must stay under the chart's fastest poll option (1s).
 */

import type { Redis } from 'ioredis';
import {
  BANDWIDTH_STATS_CONFIG,
  CACHE_TTL,
  REDIS_KEYS,
  SERVER_STATS_CONFIG,
} from '@tracearr/shared';
import { PlexClient } from './mediaServer/plex/client.js';
import type { PlexBandwidthStats, PlexStatisticsDataPoint } from './mediaServer/plex/parser.js';

interface PlexServerRow {
  id: string;
  url: string;
  token: string;
}

async function cachedFetch<T>(
  redis: Redis,
  key: string,
  ttlSeconds: number,
  fetch: () => Promise<T>
): Promise<T> {
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    // Redis unavailable or corrupt entry; fall through to a live fetch
  }

  const value = await fetch();

  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
  } catch {
    // Cache write is best-effort
  }

  return value;
}

export async function getServerResourceStats(
  redis: Redis,
  server: PlexServerRow
): Promise<PlexStatisticsDataPoint[]> {
  return cachedFetch(
    redis,
    REDIS_KEYS.SERVER_STATS_RESOURCES(server.id),
    CACHE_TTL.SERVER_STATS_RESOURCES,
    () =>
      new PlexClient({ url: server.url, token: server.token }).getServerStatistics(
        SERVER_STATS_CONFIG.TIMESPAN_SECONDS
      )
  );
}

export async function getServerBandwidthStats(
  redis: Redis,
  server: PlexServerRow
): Promise<PlexBandwidthStats> {
  return cachedFetch(
    redis,
    REDIS_KEYS.SERVER_STATS_BANDWIDTH(server.id),
    CACHE_TTL.SERVER_STATS_BANDWIDTH,
    () =>
      new PlexClient({ url: server.url, token: server.token }).getServerBandwidth(
        BANDWIDTH_STATS_CONFIG.TIMESPAN_SECONDS
      )
  );
}

export async function getServerLiveStats(redis: Redis, server: PlexServerRow) {
  const [statistics, bandwidthStats] = await Promise.all([
    getServerResourceStats(redis, server),
    getServerBandwidthStats(redis, server),
  ]);

  return {
    statistics,
    bandwidth: bandwidthStats.points,
    bandwidthSamples: bandwidthStats.samples,
    bandwidthAccounts: bandwidthStats.accounts,
    bandwidthDevices: bandwidthStats.devices,
  };
}
