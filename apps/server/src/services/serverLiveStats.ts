/**
 * Live server stats (CPU/RAM and bandwidth). Plex serves its statistics
 * endpoints behind a short Redis cache, so concurrent dashboard viewers cost
 * one Plex call per tick each half; resources and bandwidth cache separately
 * because the bandwidth TTL must stay under the chart's fastest poll option
 * (1s). Jellyfin/Emby stats arrive as server.stats events from the SSE
 * plugin and sit in a rolling Redis buffer that expires shortly after the
 * plugin goes quiet, so charts empty honestly instead of freezing.
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

interface ServerRow {
  id: string;
  type: string;
  url: string;
  token: string;
}

type PlexServerRow = Omit<ServerRow, 'type'>;

export interface PluginStatsSample {
  at: number;
  hostCpuUtilization: number | null;
  processCpuUtilization: number | null;
  hostMemoryUtilization: number | null;
  processMemoryUtilization: number | null;
}

// ~2.5 minutes of 6s samples, mirroring what Plex's resources endpoint returns
const PLUGIN_STATS_WINDOW = 27;
const PLUGIN_STATS_TTL_SECONDS = 60;

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

export async function recordServerStatsSample(
  redis: Redis,
  serverId: string,
  sample: PluginStatsSample
): Promise<void> {
  // Chart points need all four values; non-Linux hosts omit the host metrics
  if (
    sample.hostCpuUtilization == null ||
    sample.processCpuUtilization == null ||
    sample.hostMemoryUtilization == null ||
    sample.processMemoryUtilization == null
  ) {
    return;
  }

  const point: PlexStatisticsDataPoint = {
    at: sample.at,
    timespan: SERVER_STATS_CONFIG.TIMESPAN_SECONDS,
    hostCpuUtilization: sample.hostCpuUtilization,
    processCpuUtilization: sample.processCpuUtilization,
    hostMemoryUtilization: sample.hostMemoryUtilization,
    processMemoryUtilization: sample.processMemoryUtilization,
  };

  const key = REDIS_KEYS.SERVER_STATS_SAMPLES(serverId);
  try {
    await redis
      .multi()
      .lpush(key, JSON.stringify(point))
      .ltrim(key, 0, PLUGIN_STATS_WINDOW - 1)
      .expire(key, PLUGIN_STATS_TTL_SECONDS)
      .exec();
  } catch {
    // Best-effort; a missed sample is one gap in a rolling chart
  }
}

export async function getPluginServerStats(
  redis: Redis,
  serverId: string
): Promise<PlexStatisticsDataPoint[]> {
  try {
    const raw = await redis.lrange(REDIS_KEYS.SERVER_STATS_SAMPLES(serverId), 0, -1);
    return raw.flatMap((entry) => {
      try {
        return [JSON.parse(entry) as PlexStatisticsDataPoint];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export async function getServerLiveStats(redis: Redis, server: ServerRow) {
  if (server.type !== 'plex') {
    return {
      statistics: await getPluginServerStats(redis, server.id),
      bandwidth: [],
      bandwidthSamples: [],
      bandwidthAccounts: [],
      bandwidthDevices: [],
    };
  }

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
