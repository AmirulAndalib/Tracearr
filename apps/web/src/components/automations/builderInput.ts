import type { Automation } from '@tracearr/shared';
import type { AutomationBuilderInput } from '@/components/automations/builder/AutomationBuilder';

/** The builder takes a narrower shape than the API returns; this is the one conversion. */
export function toBuilderInput(automation: Automation): AutomationBuilderInput {
  return {
    id: automation.id,
    name: automation.name,
    description: automation.description,
    kind: automation.kind,
    severity: automation.severity,
    isActive: automation.isActive,
    serverId: automation.serverId,
    serverUserId: automation.serverUserId,
    userId: automation.userId,
    enforceAcrossServers: automation.enforceAcrossServers,
    conditions: automation.conditions,
    actions: automation.actions,
  };
}
