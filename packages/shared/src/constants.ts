/**
 * Shared constants for Tracearr
 */

// Rule type definitions with default parameters
export const RULE_DEFAULTS = {
  impossible_travel: {
    maxSpeedKmh: 500,
    ignoreVpnRanges: false,
  },
  simultaneous_locations: {
    minDistanceKm: 100,
  },
  device_velocity: {
    maxIps: 5,
    windowHours: 24,
  },
  concurrent_streams: {
    maxStreams: 3,
  },
  geo_restriction: {
    blockedCountries: [],
  },
} as const;

// Rule type display names
export const RULE_DISPLAY_NAMES = {
  impossible_travel: 'Impossible Travel',
  simultaneous_locations: 'Simultaneous Locations',
  device_velocity: 'Device Velocity',
  concurrent_streams: 'Concurrent Streams',
  geo_restriction: 'Geo Restriction',
} as const;

// Severity levels
export const SEVERITY_LEVELS = {
  low: { label: 'Low', priority: 1 },
  warning: { label: 'Warning', priority: 2 },
  high: { label: 'High', priority: 3 },
} as const;

// Type for severity priority numbers (1=low, 2=warning, 3=high)
export type SeverityPriority = 1 | 2 | 3;

// Helper to get severity priority from string
export function getSeverityPriority(severity: keyof typeof SEVERITY_LEVELS): SeverityPriority {
  return SEVERITY_LEVELS[severity]?.priority ?? 1;
}

// WebSocket event names
export const WS_EVENTS = {
  SESSION_STARTED: 'session:started',
  SESSION_STOPPED: 'session:stopped',
  SESSION_UPDATED: 'session:updated',
  VIOLATION_NEW: 'violation:new',
  STATS_UPDATED: 'stats:updated',
  IMPORT_PROGRESS: 'import:progress',
  SUBSCRIBE_SESSIONS: 'subscribe:sessions',
  UNSUBSCRIBE_SESSIONS: 'unsubscribe:sessions',
} as const;

// Redis key prefixes
export const REDIS_KEYS = {
  ACTIVE_SESSIONS: 'tracearr:sessions:active',
  SESSION_BY_ID: (id: string) => `tracearr:sessions:${id}`,
  USER_SESSIONS: (userId: string) => `tracearr:users:${userId}:sessions`,
  DASHBOARD_STATS: 'tracearr:stats:dashboard',
  RATE_LIMIT_LOGIN: (ip: string) => `tracearr:ratelimit:login:${ip}`,
  RATE_LIMIT_MOBILE_PAIR: (ip: string) => `tracearr:ratelimit:mobile:pair:${ip}`,
  RATE_LIMIT_MOBILE_REFRESH: (ip: string) => `tracearr:ratelimit:mobile:refresh:${ip}`,
  SERVER_HEALTH: (serverId: string) => `tracearr:servers:${serverId}:health`,
  PUBSUB_EVENTS: 'tracearr:events',
  // Notification rate limiting (sliding window counters)
  PUSH_RATE_MINUTE: (sessionId: string) => `tracearr:push:rate:minute:${sessionId}`,
  PUSH_RATE_HOUR: (sessionId: string) => `tracearr:push:rate:hour:${sessionId}`,
} as const;

// Cache TTLs in seconds
export const CACHE_TTL = {
  DASHBOARD_STATS: 60,
  ACTIVE_SESSIONS: 300,
  USER_SESSIONS: 3600,
  RATE_LIMIT: 900,
  SERVER_HEALTH: 600, // 10 minutes - servers marked unhealthy if no update
} as const;

// Notification event types (must match NotificationEventType in types.ts)
export const NOTIFICATION_EVENTS = {
  VIOLATION_DETECTED: 'violation_detected',
  STREAM_STARTED: 'stream_started',
  STREAM_STOPPED: 'stream_stopped',
  CONCURRENT_STREAMS: 'concurrent_streams',
  NEW_DEVICE: 'new_device',
  TRUST_SCORE_CHANGED: 'trust_score_changed',
  SERVER_DOWN: 'server_down',
  SERVER_UP: 'server_up',
} as const;

// API version
export const API_VERSION = 'v1';
export const API_BASE_PATH = `/api/${API_VERSION}`;

// JWT configuration
export const JWT_CONFIG = {
  ACCESS_TOKEN_EXPIRY: '48h',
  REFRESH_TOKEN_EXPIRY: '30d',
  ALGORITHM: 'HS256',
} as const;

// Polling intervals in milliseconds
export const POLLING_INTERVALS = {
  SESSIONS: 15000,
  STATS_REFRESH: 60000,
  SERVER_HEALTH: 30000,
} as const;

// Pagination defaults
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
} as const;

// GeoIP configuration
export const GEOIP_CONFIG = {
  EARTH_RADIUS_KM: 6371,
  DEFAULT_UNKNOWN_LOCATION: 'Unknown',
} as const;

// Time constants in milliseconds (avoid magic numbers)
export const TIME_MS = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
} as const;

// Session limits
export const SESSION_LIMITS = {
  MAX_RECENT_PER_USER: 100,
  RESUME_WINDOW_HOURS: 24,
  WATCH_COMPLETION_THRESHOLD: 0.8,
} as const;
