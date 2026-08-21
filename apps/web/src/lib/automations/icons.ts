/**
 * The icons automations show: one per trigger group, and one for an automation as a
 * whole taken from its first condition field.
 */

import { createElement, type ReactElement } from 'react';
import { TRIGGERS, type ConditionField, type TriggerType } from '@tracearr/shared';
import {
  ArrowUpFromLine,
  Clock,
  Globe,
  MapPin,
  Monitor,
  Pause,
  Play,
  RefreshCw,
  Server,
  Settings2,
  Shield,
  UserRound,
  Users,
  Wifi,
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
  servers: Server,
  updates: ArrowUpFromLine,
} as const satisfies Record<(typeof TRIGGERS)[TriggerType]['group'], LucideIcon>;

/** Triggers share an icon per group: the group is what a reader scans for. */
export function triggerIcon(type: TriggerType): ReactElement {
  return createElement(TRIGGER_GROUP_ICONS[TRIGGERS[type].group], { className: 'size-4' });
}

/** Built with createElement so this stays a plain module and callers stay one expression. */
export function automationIcon(automation: DescribableDefinition): ReactElement {
  const field = automation.conditions?.groups[0]?.conditions[0]?.field;
  const icon = (field && CONDITION_FIELD_ICONS[field]) || Settings2;
  return createElement(icon, { className: 'h-5 w-5' });
}
