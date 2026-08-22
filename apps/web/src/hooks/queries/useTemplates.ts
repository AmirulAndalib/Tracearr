import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, type InstantiateTemplateInput, type TemplateImportBody } from '@/lib/api';
import { AUTOMATIONS_KEY } from './useAutomations';

export const TEMPLATES_KEY = ['templates'];

/** The whole catalog in one read: every row carries the version its sentence is written from. */
export function useTemplates(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: TEMPLATES_KEY,
    queryFn: async () => (await api.templates.list()).data,
    enabled: options.enabled ?? true,
    staleTime: 1000 * 60 * 5,
  });
}

/** One template at its current version, for a bound automation's inputs. */
export function useTemplate(id: string | undefined) {
  return useQuery({
    queryKey: [...TEMPLATES_KEY, 'detail', id],
    queryFn: () => api.templates.get(id ?? ''),
    enabled: id !== undefined,
    staleTime: 1000 * 60 * 5,
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
