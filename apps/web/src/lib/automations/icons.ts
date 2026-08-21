/**
 * The icon an automation shows in a list, taken from its first condition field.
 */

import { createElement, type ReactElement } from 'react';
import type { ConditionField } from '@tracearr/shared';
import {
  Clock,
  Globe,
  MapPin,
  Monitor,
  Pause,
  RefreshCw,
  Settings2,
  Shield,
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

/** Built with createElement so this stays a plain module and callers stay one expression. */
export function automationIcon(automation: DescribableDefinition): ReactElement {
  const field = automation.conditions?.groups[0]?.conditions[0]?.field;
  const icon = (field && CONDITION_FIELD_ICONS[field]) || Settings2;
  return createElement(icon, { className: 'h-5 w-5' });
}
