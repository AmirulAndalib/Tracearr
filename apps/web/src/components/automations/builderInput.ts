import type { Automation } from '@tracearr/shared';
import type { RuleBuilderInput } from '@/components/rules/RuleBuilder';

/** The builder still speaks the rule shape; this is the one translation to it. */
export function toBuilderInput(automation: Automation): RuleBuilderInput {
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
