import { useQuery } from '@tanstack/react-query';
import { api, type RunListParams } from '@/lib/api';

export const RUNS_KEY = ['runs'];

const automationRunsKey = (automationId: string) => [...RUNS_KEY, 'automation', automationId];

export function useRun(id: string | undefined) {
  return useQuery({
    queryKey: [...RUNS_KEY, 'detail', id],
    queryFn: () => api.runs.get(id ?? ''),
    enabled: id !== undefined,
  });
}

export function useAutomationRuns(automationId: string | undefined, params: RunListParams = {}) {
  return useQuery({
    queryKey: [...automationRunsKey(automationId ?? ''), params],
    queryFn: () => api.runs.listForAutomation(automationId ?? '', params),
    enabled: automationId !== undefined,
  });
}

export function useAutomationEvaluations(automationId: string | undefined) {
  return useQuery({
    queryKey: [...RUNS_KEY, 'evaluations', automationId],
    queryFn: () => api.runs.evaluations(automationId ?? ''),
    enabled: automationId !== undefined,
  });
}
