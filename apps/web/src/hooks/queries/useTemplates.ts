import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  api,
  type InstantiateTemplateInput,
  type TemplateDetail,
  type TemplateImportBody,
} from '@/lib/api';
import { AUTOMATIONS_KEY } from './useAutomations';

export const TEMPLATES_KEY = ['templates'];

const templateKey = (id: string) => [...TEMPLATES_KEY, id];

export function useTemplates() {
  return useQuery({
    queryKey: TEMPLATES_KEY,
    queryFn: async () => (await api.templates.list()).data,
    staleTime: 1000 * 60 * 5,
  });
}

export function useTemplate(id: string | undefined) {
  return useQuery({
    queryKey: templateKey(id ?? ''),
    queryFn: () => api.templates.get(id ?? ''),
    enabled: id !== undefined,
    staleTime: 1000 * 60 * 5,
  });
}

/**
 * The version bodies behind a list of ids, keyed by id. The catalog endpoint carries
 * no definition, and the gallery needs one per card to write its sentence.
 */
export function useTemplateVersions(ids: readonly string[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: templateKey(id),
      queryFn: () => api.templates.get(id),
      staleTime: 1000 * 60 * 5,
    })),
    combine: (results) => {
      const byId = new Map<string, TemplateDetail>();
      for (const result of results) {
        if (result.data) byId.set(result.data.id, result.data);
      }
      return { byId, isLoading: results.some((result) => result.isLoading) };
    },
  });
}

export function useInstantiateTemplate() {
  const { t } = useTranslation(['pages', 'notifications']);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...body }: InstantiateTemplateInput & { id: string }) =>
      api.templates.instantiate(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AUTOMATIONS_KEY });
      void queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
      toast.success(t('notifications:toast.success.automationCreated.title'), {
        description: t('notifications:toast.success.automationCreated.message'),
      });
    },
    onError: (error: Error) => {
      toast.error(t('pages:automations.bind.failed'), { description: error.message });
    },
  });
}

/** Reads a pasted code without writing anything, so the review can show what it is. */
export function usePreviewTemplate() {
  return useMutation({ mutationFn: (body: TemplateImportBody) => api.templates.preview(body) });
}

export function useImportTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: TemplateImportBody) => api.templates.create(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
    },
  });
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.templates.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
    },
  });
}
