import { useMemo, useRef, useState, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, MoreHorizontal } from 'lucide-react';
import {
  ACTION_TYPES,
  type Action,
  type ActionType,
  type AutomationActions,
} from '@tracearr/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FieldError } from '@/components/ui/field';
import { ItemGroup } from '@/components/ui/item';
import { Kbd } from '@/components/ui/kbd';
import { actionLabel, actionPickerEntries, suggestedValues } from '@/lib/automations';
import { idOf, nodeDomId, type BuilderDispatch } from './builderReducer';
import { ActionRow } from './ActionRow';
import { IfRow } from './IfRow';
import { NodePicker } from './NodePicker';
import { useRowKeyboard } from './useRowKeyboard';
import { BUILDER_SECTIONS, type NodeIssues } from './validation';
import type { BuilderRefs } from './builderRefs';

interface ActionsSectionProps {
  actions: AutomationActions;
  refs: BuilderRefs;
  issues: NodeIssues;
  pulseId: string | null;
  dispatch: BuilderDispatch;
}

/** What a removal is waiting on: the node, and where the keyboard goes afterwards. */
interface PendingRemoval {
  id: string;
  reclaim: () => void;
}

function isActionType(value: string): value is ActionType {
  return (ACTION_TYPES as readonly string[]).includes(value);
}

function rowName(t: ReturnType<typeof useTranslation<'pages'>>['t'], action: Action): string {
  return action.type === 'if'
    ? t('automations.catalog.actions.if.label')
    : actionLabel(t, action.type);
}

/** What happens once the triggers fire and the conditions hold, in order. */
export function ActionsSection({ actions, refs, issues, pulseId, dispatch }: ActionsSectionProps) {
  const { t } = useTranslation(['pages', 'common']);
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const [pending, setPending] = useState<PendingRemoval | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const list = actions.actions;
  const entries = useMemo(() => actionPickerEntries(t), [t]);
  const suggested = useMemo(
    () =>
      suggestedValues(
        entries,
        list.map((action) => action.type)
      ),
    [entries, list]
  );

  const toggleCollapsed = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const rows = useRowKeyboard({
    ids: list.map(idOf),
    sectionRef,
    onToggle: (id) => dispatch({ type: 'toggleNode', id }),
    onRemove: (id, index) => setPending({ id, reclaim: () => rows.reclaim(index) }),
    onMove: (id, delta) => dispatch({ type: 'moveAction', id, delta }),
    onExpand: toggleCollapsed,
  });

  const sectionIssues = issues.get(BUILDER_SECTIONS.actions);

  const menuFor = (action: Action, index: number) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('pages:automations.builder.actions.menu', { name: rowName(t, action) })}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={index === 0}
          onSelect={() => dispatch({ type: 'moveAction', id: idOf(action), delta: -1 })}
        >
          <ArrowUp />
          {t('pages:automations.builder.actions.moveUp', { name: rowName(t, action) })}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={index === list.length - 1}
          onSelect={() => dispatch({ type: 'moveAction', id: idOf(action), delta: 1 })}
        >
          <ArrowDown />
          {t('pages:automations.builder.actions.moveDown', { name: rowName(t, action) })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <section
      ref={sectionRef}
      id={nodeDomId(BUILDER_SECTIONS.actions)}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="space-y-3 outline-none"
    >
      <h2 id={headingId} className="text-base font-semibold">
        {t('pages:automations.builder.actions.sectionTitle')}
      </h2>

      {list.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t('pages:automations.builder.actions.empty')}
        </p>
      ) : (
        <ItemGroup className="gap-2">
          {list.map((action, index) =>
            action.type === 'if' ? (
              <IfRow
                key={idOf(action)}
                action={action}
                refs={refs}
                issues={issues}
                pulseId={pulseId}
                rowProps={rows.rowProps(index)}
                shortcuts={rows.shortcuts}
                open={!collapsed.has(idOf(action))}
                onOpenChange={() => toggleCollapsed(idOf(action))}
                menu={menuFor(action, index)}
                onRemove={() =>
                  setPending({ id: idOf(action), reclaim: () => rows.reclaim(index) })
                }
                onRemoveBranchAction={(id, reclaim) => setPending({ id, reclaim })}
                dispatch={dispatch}
              />
            ) : (
              <ActionRow
                key={idOf(action)}
                action={action}
                issues={issues.get(idOf(action))}
                pulsing={pulseId === idOf(action)}
                rowProps={rows.rowProps(index)}
                shortcuts={rows.shortcuts}
                menu={menuFor(action, index)}
                onRemove={() =>
                  setPending({ id: idOf(action), reclaim: () => rows.reclaim(index) })
                }
                dispatch={dispatch}
              />
            )
          )}
        </ItemGroup>
      )}

      {sectionIssues?.map((message) => (
        <FieldError key={message}>{message}</FieldError>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <NodePicker
          entries={entries}
          suggested={suggested}
          label={t('pages:automations.builder.actions.add')}
          onSelect={(value) => {
            if (isActionType(value)) dispatch({ type: 'addAction', actionType: value });
          }}
        />
        {list.length > 0 && (
          <span className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
            <span className="flex items-center gap-1">
              <Kbd>D</Kbd>
              {t('pages:automations.builder.rows.toggleHint')}
            </span>
            <span className="flex items-center gap-1">
              <Kbd>E</Kbd>
              {t('pages:automations.builder.rows.expandHint')}
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Alt</Kbd>
              <Kbd>↑</Kbd>
              {t('pages:automations.builder.rows.moveHint')}
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Del</Kbd>
              {t('pages:automations.builder.rows.removeHint')}
            </span>
          </span>
        )}
      </div>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={t('pages:automations.builder.actions.confirmRemoveTitle')}
        description={t('pages:automations.builder.actions.confirmRemoveDescription')}
        confirmLabel={t('common:actions.remove')}
        cancelLabel={t('common:actions.cancel')}
        onConfirm={() => {
          if (!pending) return;
          dispatch({ type: 'removeNode', id: pending.id });
          pending.reclaim();
          setPending(null);
        }}
      />
    </section>
  );
}
