import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { LeafAction } from '@tracearr/shared';
import { FieldError } from '@/components/ui/field';
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from '@/components/ui/item';
import {
  actionHint,
  actionIcon,
  actionLabel,
  applyActionFieldChange,
  visibleConfigFields,
} from '@/lib/automations';
import { cn } from '@/lib/utils';
import { idOf, nodeDomId, type BuilderDispatch } from './builderReducer';
import { ActionConfigField } from './fields';
import { RowActions } from './RowActions';
import { RowWarning } from './ConditionRow';
import type { RowProps } from './useRowKeyboard';

interface ActionRowProps {
  action: LeafAction;
  issues: string[] | undefined;
  pulsing: boolean;
  rowProps: RowProps;
  shortcuts: string;
  /** The overflow menu, when the row sits in a list that can be reordered. */
  menu?: ReactNode;
  /** Removal is confirmed by the section, so the row only asks for it. */
  onRemove: () => void;
  dispatch: BuilderDispatch;
}

/** One thing the automation does, with everything it needs on the row itself. */
export function ActionRow({
  action,
  issues,
  pulsing,
  rowProps,
  shortcuts,
  menu,
  onRemove,
  dispatch,
}: ActionRowProps) {
  const { t } = useTranslation('pages');
  const id = idOf(action);
  const name = actionLabel(t, action.type);
  const hint = actionHint(t, action.type);
  const enabled = action.enabled !== false;

  const readValue = (field: string) => (action as unknown as Record<string, unknown>)[field];

  return (
    <Item
      role="listitem"
      id={nodeDomId(id)}
      variant="outline"
      size="sm"
      tabIndex={rowProps.tabIndex}
      aria-keyshortcuts={shortcuts}
      data-pulse={pulsing}
      onFocus={rowProps.onFocus}
      onKeyDown={rowProps.onKeyDown}
      className={cn(
        '@container items-start',
        'data-[pulse=true]:ring-primary/60 data-[pulse=true]:ring-2',
        !enabled && 'opacity-60'
      )}
    >
      <ItemMedia variant="icon">{actionIcon(action.type)}</ItemMedia>
      <ItemContent className="gap-3">
        <ItemTitle>{name}</ItemTitle>
        <div className="grid w-full gap-3 @md:grid-cols-2">
          {visibleConfigFields(action).map((field) => (
            <ActionConfigField
              key={field.name}
              t={t}
              field={field}
              value={readValue(field.name)}
              onChange={(value) =>
                dispatch({
                  type: 'setAction',
                  id,
                  action: applyActionFieldChange(action, field.name, value),
                })
              }
            />
          ))}
        </div>
        {hint && <RowWarning message={hint} />}
        {issues?.map((message) => (
          <FieldError key={message}>{message}</FieldError>
        ))}
      </ItemContent>
      <ItemActions>
        <RowActions
          name={name}
          enabled={enabled}
          onToggle={() => dispatch({ type: 'toggleNode', id })}
          onRemove={onRemove}
        >
          {menu}
        </RowActions>
      </ItemActions>
    </Item>
  );
}
