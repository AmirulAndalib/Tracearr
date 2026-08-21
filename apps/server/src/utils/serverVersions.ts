/**
 * Media-server versions: what a server reports about itself, what its vendor ships,
 * and which of the two is newer. Every feed is public and read without a token.
 */

import type { ServerType } from '@tracearr/shared';
import { fetchJson } from './http.js';
import { createLogger } from './logger.js';
import { compareVersions, maxVersion } from './pluginVersion.js';

const logger = createLogger('server-versions');

const PLEX_DOWNLOADS_URL = 'https://plex.tv/api/downloads/5.json';
const GITHUB_LATEST: Record<'jellyfin' | 'emby', string> = {
  jellyfin: 'https://api.github.com/repos/jellyfin/jellyfin/releases/latest',
  emby: 'https://api.github.com/repos/MediaBrowser/Emby.Releases/releases/latest',
};

/** Where a nudge sends the reader; the feeds carry per-release links, these outlive them. */
export const SERVER_RELEASE_PAGES: Record<ServerType, string> = {
  plex: 'https://plex.tv/media-server-downloads',
  jellyfin: 'https://github.com/jellyfin/jellyfin/releases/latest',
  emby: 'https://github.com/MediaBrowser/Emby.Releases/releases/latest',
};

const FEED_TIMEOUT_MS = 10_000;
// Three or four parts: `compareVersions` reads a shorter version's missing parts as zeros,
// so `10.11` would compare equal to `10.11.0.0` and nudge about a release nobody shipped.
const DOTTED = /^\d+(\.\d+){2,3}$/;

interface PlexDownloads {
  computer?: Record<string, { version?: unknown } | undefined>;
}

/**
 * The comparable digits of a version: Plex appends a build hash, Jellyfin tags with a
 * leading `v`, Emby is already numeric. Null when what is left is not three or four
 * dotted numbers.
 */
export function normalizeServerVersion(type: ServerType, raw: string): string | null {
  const trimmed = raw.trim();
  let candidate = trimmed;
  if (type === 'plex') candidate = trimmed.split('-')[0] ?? '';
  if (type === 'jellyfin') candidate = trimmed.replace(/^v/, '');
  return DOTTED.test(candidate) ? candidate : null;
}

/** An unparseable version on either side is never newer: a nudge needs both numbers. */
export function isNewerServerVersion(type: ServerType, latest: string, installed: string): boolean {
  const newer = normalizeServerVersion(type, latest);
  const current = normalizeServerVersion(type, installed);
  if (!newer || !current) return false;
  return compareVersions(newer, current) > 0;
}

/** Plex publishes one version per platform; they move together, so the newest stands in. */
async function latestPlexVersion(platform?: string | null): Promise<string | null> {
  const feed = await fetchJson<PlexDownloads>(PLEX_DOWNLOADS_URL, {
    timeout: FEED_TIMEOUT_MS,
    service: 'plex',
  });
  const computer = feed.computer ?? {};
  const named = platform ? computer[platform] : undefined;
  const entries = named ? [named] : Object.values(computer);
  const versions = entries
    .map((entry) =>
      typeof entry?.version === 'string' ? normalizeServerVersion('plex', entry.version) : null
    )
    .filter((version): version is string => version !== null);
  return maxVersion(versions);
}

async function latestGithubVersion(type: 'jellyfin' | 'emby'): Promise<string | null> {
  const release = await fetchJson<{ tag_name?: unknown }>(GITHUB_LATEST[type], {
    timeout: FEED_TIMEOUT_MS,
    service: 'github',
  });
  return typeof release.tag_name === 'string'
    ? normalizeServerVersion(type, release.tag_name)
    : null;
}

/** The newest release the vendor publishes, normalized. Any failure reads as "unknown". */
export async function latestVersionFor(
  type: ServerType,
  platform?: string | null
): Promise<string | null> {
  try {
    return type === 'plex' ? await latestPlexVersion(platform) : await latestGithubVersion(type);
  } catch (error) {
    logger.debug('Latest version lookup failed', { type, error });
    return null;
  }
}
