import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Loader2, Save, TriangleAlert } from 'lucide-react';
import type { Automation } from '@tracearr/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Kbd } from '@/components/ui/kbd';
import { useSettings } from '@/hooks/queries/useSettings';
import { useCreateAutomation, useUpdateAutomation } from '@/hooks/queries/useAutomations';
import { useDestinations } from '@/hooks/queries/useDestinations';
import { useAutomationFilterOptions } from '@/hooks/queries/useHistory';
import { useServer } from '@/hooks/useServer';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import {
  canEnforceAcrossServers,
  describeAutomation,
  scopeToPayload,
  type DescribeRefs,
} from '@/lib/automations';
import {
  builderReducer,
  emptyBuilderState,
  nodeDomId,
  toCreateInput,
  type BuilderAction,
} from './builderReducer';
import { HeaderCard } from './HeaderCard';
import { Sentence } from './Sentence';
import { TriggersSection } from './TriggersSection';
import {
  BUILDER_SECTIONS,
  builderIssues,
  issuesByNode,
  serverIssues,
  type BuilderIssue,
} from './validation';

interface AutomationBuilderProps {
  /** Absent while creating; the loaded row when editing. */
  automation?: Automation;
}

/** How long a node stays highlighted after the sentence or the error count jumps to it. */
const PULSE_MS = 1200;

/** What a change marks as touched, so an untouched field is never shown as wrong. */
function touchedKeys(action: BuilderAction): string[] {
  switch (action.type) {
    case 'setName':
      return [BUILDER_SECTIONS.name];
    case 'setScope':
      return [BUILDER_SECTIONS.scope];
    case 'addTrigger':
      return [BUILDER_SECTIONS.triggers];
    // Only trigger rows carry node actions so far; later sections name their own.
    case 'setTriggerParam':
    case 'toggleNode':
    case 'removeNode':
      return [BUILDER_SECTIONS.triggers, action.id];
    default:
      return [];
  }
}

export function AutomationBuilder({ automation }: AutomationBuilderProps) {
  const { t } = useTranslation(['pages', 'common']);
  const navigate = useNavigate();
  const { servers } = useServer();
  const { data: settings } = useSettings();
  const { data: filterOptions } = useAutomationFilterOptions();
  const { data: destinations } = useDestinations();
  const createAutomation = useCreateAutomation();
  const updateAutomation = useUpdateAutomation();

  const [state, dispatch] = useReducer(builderReducer, undefined, emptyBuilderState);
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  const [pulseId, setPulseId] = useState<string | null>(null);
  const [rejected, setRejected] = useState<BuilderIssue[]>([]);
  const [leavingTo, setLeavingTo] = useState<string | null>(null);
  const loadedIdRef = useRef<string | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  const blocker = useUnsavedChanges(state.dirty);

  const track = useCallback((action: BuilderAction) => {
    const keys = touchedKeys(action);
    if (keys.length > 0) {
      setTouched((current) => {
        if (keys.every((key) => current.has(key))) return current;
        const next = new Set(current);
        for (const key of keys) next.add(key);
        return next;
      });
    }
    dispatch(action);
  }, []);

  // A refetch must not overwrite edits, so the row seeds the form once per automation.
  useEffect(() => {
    if (!automation || loadedIdRef.current === automation.id) return;
    loadedIdRef.current = automation.id;
    dispatch({ type: 'load', automation });
  }, [automation]);

  // What the API rejected describes the definition it was sent, so any edit retires it
  // and Save is free to go again.
  useEffect(() => setRejected([]), [state]);

  useEffect(() => {
    if (pulseId === null) return;
    const timer = window.setTimeout(() => setPulseId(null), PULSE_MS);
    return () => window.clearTimeout(timer);
  }, [pulseId]);

  // Once the save has landed the guard is clean, and only then may the page leave.
  useEffect(() => {
    if (leavingTo !== null && !state.dirty) void navigate(leavingTo);
  }, [leavingTo, state.dirty, navigate]);

  const describeRefs = useMemo<DescribeRefs>(() => {
    const accounts: Record<string, string> = {};
    if (automation?.scopeRef?.kind === 'account') {
      accounts[automation.scopeRef.id] = automation.scopeRef.name;
    }
    return {
      servers: Object.fromEntries(servers.map((server) => [server.id, server.name])),
      users: Object.fromEntries(
        (filterOptions?.users ?? []).map((user) => [user.id, user.identityName || user.username])
      ),
      countries: Object.fromEntries(
        (filterOptions?.countries ?? []).map((country) => [country.code, country.name])
      ),
      accounts,
      destinations: Object.fromEntries(
        (destinations ?? []).map((destination) => [destination.id, destination.name])
      ),
    };
  }, [servers, filterOptions, destinations, automation]);

  const fragments = useMemo(
    () =>
      describeAutomation(
        {
          kind: state.kind,
          triggers: state.triggers,
          conditions: state.conditions,
          actions: state.actions,
          ...scopeToPayload(state.scope),
        },
        describeRefs,
        t,
        settings?.unitSystem ?? 'metric'
      ),
    [state, describeRefs, t, settings]
  );

  const localIssues = useMemo(() => builderIssues(state, t), [state, t]);
  const issues = useMemo(() => [...localIssues, ...rejected], [localIssues, rejected]);
  // The footer counts everything from the first paint; a row only turns red once its
  // own field has been touched, or once Save has asked for the whole form.
  const byNode = useMemo(
    () => issuesByNode(submitted ? issues : issues.filter((issue) => touched.has(issue.nodeId))),
    [issues, submitted, touched]
  );

  const focusNode = (nodeId: string) => {
    setPulseId(nodeId);
    const node = document.getElementById(nodeDomId(nodeId));
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node?.focus();
  };

  const revealFirstIssue = () => {
    setSubmitted(true);
    const first = issues[0];
    if (first) focusNode(first.nodeId);
  };

  // `/` reaches the picker of whatever section the caret sits in, or the first one.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) {
        return;
      }
      const pickers = [
        ...(pageRef.current?.querySelectorAll<HTMLElement>('[data-node-picker]') ?? []),
      ];
      const nearest =
        pickers.find((picker) => active !== null && picker.closest('section')?.contains(active)) ??
        pickers[0];
      if (!nearest) return;
      event.preventDefault();

      // Clicking an open picker's trigger would shut it, so an open one just takes the caret.
      if (nearest.getAttribute('aria-expanded') === 'true') {
        const contentId = nearest.getAttribute('aria-controls');
        const content = contentId === null ? null : document.getElementById(contentId);
        content?.querySelector('input')?.focus();
        return;
      }
      nearest.click();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const isPending = createAutomation.isPending || updateAutomation.isPending;
  const hasIssues = issues.length > 0;

  const handleSave = async () => {
    if (isPending) return;
    // A form the page itself can fault never reaches the API; Save shows what it found.
    if (localIssues.length > 0) {
      revealFirstIssue();
      return;
    }

    try {
      const input = toCreateInput(state);
      const saved = automation
        ? await updateAutomation.mutateAsync({ id: automation.id, data: input })
        : await createAutomation.mutateAsync(input);
      dispatch({ type: 'saved' });
      setLeavingTo(`/automations/${saved.id}`);
    } catch (error) {
      // The mutation hook has already toasted; what the API named goes back to its row.
      setSubmitted(true);
      setRejected(serverIssues(state, error, t));
    }
  };

  return (
    <div ref={pageRef} className="mx-auto w-full max-w-5xl space-y-6">
      <HeaderCard
        state={state}
        issues={byNode}
        canEnforceAcrossServers={canEnforceAcrossServers(state.scope, state.conditions)}
        sentence={<Sentence fragments={fragments} onFocusNode={focusNode} />}
        dispatch={track}
      />

      <TriggersSection
        triggers={state.triggers}
        issues={byNode}
        pulseId={pulseId}
        dispatch={track}
      />

      <div className="bg-background/95 sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t py-3 backdrop-blur">
        <span className="text-muted-foreground hidden items-center gap-1 text-xs sm:flex">
          <Kbd>/</Kbd>
          {t('pages:automations.builder.footer.search')}
        </span>

        {hasIssues && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={revealFirstIssue}
          >
            <TriangleAlert />
            {t('pages:automations.builder.footer.problems', { count: issues.length })}
          </Button>
        )}

        <div className="ml-auto flex items-center gap-3">
          <Button type="button" variant="outline" onClick={() => void navigate('/automations')}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="button" disabled={isPending} onClick={() => void handleSave()}>
            {isPending ? <Loader2 className="animate-spin" /> : <Save />}
            {isPending
              ? t('pages:automations.builder.saving')
              : automation
                ? t('pages:automations.updateAutomation')
                : t('pages:automations.createAutomation')}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
        title={t('pages:automations.builder.leave.title')}
        description={t('common:confirmations.unsavedChanges')}
        confirmLabel={t('pages:automations.builder.leave.confirm')}
        cancelLabel={t('common:actions.cancel')}
        onConfirm={() => blocker.proceed?.()}
      />
    </div>
  );
}
