import {
  reEvaluateRulesOnPauseState,
  reEvaluateRulesOnTranscodeChange,
} from '../../../jobs/poller/sessionLifecycle.js';
import { subscribe } from './dispatcher.js';

let registered = false;

/** Stage 1: the twins are the subscribers. Replaced by the evaluate/record/act pipeline in stage 2. */
export function registerRuleSubscribers(): void {
  if (registered) return;
  registered = true;

  subscribe('session.transcode_changed', 'transcode-reeval', async (event, inputs) => {
    if (!inputs) return;
    const violations = await reEvaluateRulesOnTranscodeChange({
      existingSession: event.raw.existingSession,
      processed: event.raw.processed,
      server: event.server,
      serverUser: event.serverUser,
      activeRulesV2: inputs.activeRulesV2,
      activeSessions: inputs.activeSessions,
      recentSessions: inputs.recentSessions,
    });
    return { violations };
  });

  subscribe('session.paused', 'pause-reeval', async (event, inputs) => {
    if (!inputs) return;
    const violations = await reEvaluateRulesOnPauseState({
      existingSession: event.raw.existingSession,
      processed: event.raw.processed,
      pauseData: event.pauseData,
      server: event.server,
      serverUser: event.serverUser,
      activeRulesV2: inputs.activeRulesV2,
      activeSessions: inputs.activeSessions,
      recentSessions: inputs.recentSessions,
    });
    return { violations };
  });
}

export function resetRuleSubscribersForTests(): void {
  registered = false;
}
