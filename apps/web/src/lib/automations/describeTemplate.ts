/**
 * A template's sentence, with whatever the reader has bound so far filled in. The
 * gallery card, the binding form and the import review all read from here.
 */

import { slotValueFor } from '@tracearr/shared';
import type { PagesKey } from '@tracearr/translations';
import type {
  ConditionField,
  TemplateDefinition,
  TemplateInput,
  UnitSystem,
} from '@tracearr/shared';
import {
  describeAutomation,
  type DescribableDefinition,
  type DescribeFragment,
  type DescribeRefs,
} from './describe';
import type { Translate } from './conditionFields';

export interface TemplateVersionBody {
  inputs: TemplateInput[];
  definition: TemplateDefinition;
}

/** An optional input left unbound; the key it sits under drops out of the definition. */
const DROP = Symbol('unbound');

type TemplateTextKey = Extract<PagesKey, `automations.templates.${string}.${string}`>;

/**
 * The catalog ships copy for the templates it bundles; an import brings its own words.
 * An envelope's own text is never handed to i18next, which would resolve `$t(...)` in it.
 */
const NO_COPY = '\u0000tracearr.noCopy';

function templateText(t: Translate, slug: string, field: string, fallback: string): string {
  const copy = t(`automations.templates.${slug}.${field}` as TemplateTextKey, {
    defaultValue: NO_COPY,
  });
  return copy === NO_COPY ? fallback : copy;
}

export function templateName(t: Translate, template: { slug: string; name: string }): string {
  return templateText(t, template.slug, 'name', template.name);
}

export function templateDescription(
  t: Translate,
  template: { slug: string; description: string }
): string {
  return templateText(t, template.slug, 'description', template.description);
}

/** Words a reader might search for that the name and the sentence do not carry. */
export function templateKeywords(t: Translate, slug: string): string {
  return templateText(t, slug, 'keywords', '');
}

/** The four kinds the app words better than a bare envelope label does. */
function kindLabel(t: Translate, kind: TemplateInput['kind']): string | undefined {
  switch (kind) {
    case 'server':
      return t('automations.bind.serverLabel');
    case 'account':
      return t('automations.bind.accountLabel');
    case 'person':
      return t('automations.bind.personLabel');
    case 'destinations':
      return t('automations.bind.destinationsLabel');
    default:
      return undefined;
  }
}

/** What a field row and the sentence's placeholder both call an input. */
export function templateInputLabel(t: Translate, input: TemplateInput): string {
  const bare = input.label.trim().toLowerCase() === input.kind;
  return (bare ? kindLabel(t, input.kind) : undefined) ?? input.label;
}

/** A pick that holds nothing reads as unbound, so the sentence keeps naming the input. */
export const isUnbound = (value: unknown): boolean =>
  value === undefined || value === '' || (Array.isArray(value) && value.length === 0);

function placeholderKey(node: unknown): string | undefined {
  if (node === null || typeof node !== 'object' || !('$input' in node)) return undefined;
  const { $input: key } = node;
  return typeof key === 'string' ? key : undefined;
}

/**
 * The definition with bound values and defaults substituted. A required input nothing
 * filled stays a placeholder so the sentence can name it; an optional one drops out.
 */
function bindDefinition(
  version: TemplateVersionBody,
  bound: Record<string, unknown>
): DescribableDefinition {
  const resolved = new Map<string, { input: TemplateInput; value: unknown }>();
  for (const input of version.inputs) {
    const value = isUnbound(bound[input.key])
      ? 'default' in input
        ? input.default
        : undefined
      : bound[input.key];
    if (!isUnbound(value)) resolved.set(input.key, { input, value });
  }

  const substitute = (node: unknown, slot: string): unknown => {
    const key = placeholderKey(node);
    if (key !== undefined) {
      const binding = resolved.get(key);
      if (binding) return slotValueFor(binding.input, binding.value, slot);
      return version.inputs.find((input) => input.key === key)?.required ? node : DROP;
    }
    if (Array.isArray(node)) {
      return node.map((item) => substitute(item, slot)).filter((item) => item !== DROP);
    }
    if (node !== null && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [childKey, child] of Object.entries(node as Record<string, unknown>)) {
        const value = substitute(child, childKey);
        if (value !== DROP) out[childKey] = value;
      }
      return out;
    }
    return node;
  };

  const { definition } = version;
  const scope: DescribableDefinition['scope'] = {};
  for (const [key, value] of Object.entries(definition.scope)) {
    const bindingValue = substitute(value, key);
    if (bindingValue !== DROP && bindingValue !== undefined) {
      Object.assign(scope, { [key]: bindingValue });
    }
  }

  return {
    kind: definition.kind,
    triggers: substitute(definition.triggers, 'triggers') as DescribableDefinition['triggers'],
    conditions: substitute(
      definition.conditions,
      'conditions'
    ) as DescribableDefinition['conditions'],
    actions: substitute(definition.actions, 'actions') as DescribableDefinition['actions'],
    scope,
  };
}

/**
 * The condition field an input's value lands in, so a number is edited and shown the
 * way the builder edits and shows that same condition.
 */
export function conditionFieldForInput(
  definition: TemplateDefinition,
  key: string
): ConditionField | undefined {
  const inGroups = (conditions: TemplateDefinition['conditions']): ConditionField | undefined => {
    for (const group of conditions.groups) {
      for (const condition of group.conditions) {
        if (placeholderKey(condition.value) === key) return condition.field;
      }
    }
    return undefined;
  };

  const top = inGroups(definition.conditions);
  if (top) return top;
  for (const action of definition.actions.actions) {
    if (action.type !== 'if') continue;
    const nested = inGroups(action.conditions);
    if (nested) return nested;
  }
  return undefined;
}

/** The template in words, in the reader's units, with the parts they have filled in. */
export function describeTemplate(
  version: TemplateVersionBody,
  bound: Record<string, unknown>,
  refs: DescribeRefs,
  t: Translate,
  unitSystem: UnitSystem
): DescribeFragment[] {
  const definition = bindDefinition(version, bound);
  return describeAutomation(
    {
      ...definition,
      inputs: version.inputs.map((input) => ({
        key: input.key,
        label: templateInputLabel(t, input),
      })),
    },
    refs,
    t,
    unitSystem
  );
}
