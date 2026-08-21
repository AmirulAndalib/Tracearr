/**
 * The icons automations show: one per trigger group, one per action type, and one for
 * an automation as a whole taken from its first condition field.
 */

import { createElement, type ReactElement } from 'react';
import { TRIGGERS, type ActionType, type ConditionField, type TriggerType } from '@tracearr/shared';
import {
  ArrowUpFromLine,
  Bell,
  Clock,
  Globe,
  Library,
  MapPin,
  MessageSquare,
  Monitor,
  Pause,
  Play,
  RefreshCw,
  Server,
  Settings2,
  Shield,
  Split,
  TrendingUp,
  UserRound,
  Users,
  Wifi,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { DescribableDefinition } from './describe';

const CONDITION_FIELD_ICONS: Partial<Record<ConditionField, LucideIcon>> = {
  concurrent_streams: Users,
  active_session_distance_km: MapPin,
  travel_speed_kmh: MapPin,
  unique_ips_in_window: Zap,
  unique_devices_in_window: Zap,
  inactive_days: Clock,
  current_pause_minutes: Pause,
  total_pause_minutes: Pause,
  source_resolution: Monitor,
  output_resolution: Monitor,
  is_transcoding: RefreshCw,
  is_transcode_downgrade: RefreshCw,
  source_bitrate_mbps: Monitor,
  trust_score: Shield,
  account_age_days: Clock,
  country: Globe,
  is_local_network: Wifi,
  ip_in_range: Globe,
};

const TRIGGER_GROUP_ICONS = {
  sessions: Play,
  accounts: UserRound,
  library: Library,
  servers: Server,
  updates: ArrowUpFromLine,
} as const satisfies Record<(typeof TRIGGERS)[TriggerType]['group'], LucideIcon>;

const ACTION_ICONS = {
  send: Bell,
  trust: TrendingUp,
  kill_stream: XCircle,
  message_client: MessageSquare,
  if: Split,
} as const satisfies Record<ActionType, LucideIcon>;

/** Triggers share an icon per group: the group is what a reader scans for. */
export function triggerIcon(type: TriggerType): ReactElement {
  return createElement(TRIGGER_GROUP_ICONS[TRIGGERS[type].group], { className: 'size-4' });
}

export function actionIcon(type: ActionType, className = 'size-4'): ReactElement {
  return createElement(ACTION_ICONS[type], { className });
}

/** Built with createElement so this stays a plain module and callers stay one expression. */
export function automationIcon(automation: DescribableDefinition): ReactElement {
  const field = automation.conditions?.groups[0]?.conditions[0]?.field;
  const icon = (field && CONDITION_FIELD_ICONS[field]) || Settings2;
  return createElement(icon, { className: 'h-5 w-5' });
}
