import { beforeAll, describe, expect, it } from 'vitest';
import { i18n, initI18n } from '@tracearr/translations';
import { materializeTemplate } from '@tracearr/shared';
import type { TemplateDefinition, TemplateInput } from '@tracearr/shared';
import {
  describeTemplate,
  templateDescription,
  templateDraft,
  templateInputLabel,
  templateName,
} from '../describeTemplate';
import type { Translate } from '../conditionFields';

let t: Translate;

beforeAll(async () => {
  await initI18n({ lng: 'en' });
  t = i18n.getFixedT(null, 'pages');
});

const definition = (overrides: Partial<TemplateDefinition> = {}): TemplateDefinition => ({
  kind: 'notification',
  triggers: [{ id: 'trigger-1', type: 'session.started', enabled: true }],
  conditions: { groups: [] },
  actions: {
    actions: [{ id: 'action-1', type: 'send', enabled: true, to: { $input: 'to' } }],
  },
  scope: { serverId: { $input: 'server' } },
  enforceAcrossServers: false,
  cooldownMinutes: null,
  ...overrides,
});

const inputs: TemplateInput[] = [
  { key: 'server', kind: 'server', label: 'Server', required: false },
  { key: 'to', kind: 'destinations', label: 'Send to', required: true },
];

const held = (): TemplateDefinition =>
  definition({
    triggers: [
      {
        id: 'trigger-1',
        type: 'session.held_for',
        enabled: true,
        params: { minutes: { $input: 'minutes' }, measure: 'current' },
      },
    ],
  });

function text(
  version: { inputs: TemplateInput[]; definition: TemplateDefinition },
  bound: Record<string, unknown> = {},
  refs = {}
): string {
  return describeTemplate(version, bound, refs, t, 'metric')
    .map((fragment) => fragment.text)
    .join(' ');
}

describe('describeTemplate', () => {
  it('names a required input that is still unbound', () => {
    expect(text({ inputs, definition: definition() })).toBe(
      'When a stream starts, send to [Send to].'
    );
  });

  it('reads an unbound optional input as its default', () => {
    const version = {
      inputs: [
        ...inputs,
        {
          key: 'minutes',
          kind: 'duration',
          unit: 'minutes',
          label: 'Minutes paused',
          required: false,
          default: 30,
        } satisfies TemplateInput,
      ],
      definition: held(),
    };

    expect(text(version)).toBe('When a stream has been paused for 30 minutes, send to [Send to].');
  });

  it('drops the scope tail while the optional server is unbound', () => {
    expect(text({ inputs, definition: definition() })).not.toContain('Applies to');
  });

  it('names the server once one is bound', () => {
    const sentence = text(
      { inputs, definition: definition() },
      { server: 'server-1', to: ['dest-1'] },
      { servers: { 'server-1': 'Beehive' }, destinations: { 'dest-1': 'Team Discord' } }
    );

    expect(sentence).toBe('When a stream starts, send to Team Discord. Applies to Beehive.');
  });

  it('reads an empty destination pick as unbound rather than as nowhere', () => {
    expect(text({ inputs, definition: definition() }, { to: [] })).toContain('[Send to]');
  });

  it('converts a duration input into the unit its slot stores', () => {
    const version = {
      inputs: [
        ...inputs,
        {
          key: 'minutes',
          kind: 'duration',
          unit: 'hours',
          label: 'Hours paused',
          required: false,
          default: 2,
        } satisfies TemplateInput,
      ],
      definition: held(),
    };

    expect(text(version)).toContain('paused for 120 minutes');
  });

  it('lands an hours input on a cooldown_minutes slot as the same minutes the server stores', () => {
    const hours: TemplateInput = {
      key: 'quiet',
      kind: 'duration',
      unit: 'hours',
      label: 'Quiet for',
      required: true,
    };
    // materializeTemplate validates its result, so every id here is a real one.
    const sendId = 'c4d5e6f7-8a9b-4c1d-8e2f-3a4b5c6d7e8f';
    const version = {
      inputs: [...inputs, hours],
      definition: definition({
        triggers: [
          { id: '7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b', type: 'session.started', enabled: true },
        ],
        actions: {
          actions: [
            {
              id: sendId,
              type: 'send',
              enabled: true,
              to: { $input: 'to' },
              cooldown_minutes: { $input: 'quiet' },
            },
          ],
        },
      }),
    };
    // materializeTemplate validates its result, so the ids have to be real ones.
    const bound = {
      server: '2f1c0d9e-7a53-4b21-9c4e-11d2a3b4c5d6',
      to: ['9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'],
      quiet: 2,
    };

    const drafted = templateDraft(version, bound, { name: 'Quiet hours', isActive: true });
    const materialized = materializeTemplate(version, bound, { name: 'Quiet hours' });

    expect(drafted.actions.actions[0]).toMatchObject({ cooldown_minutes: 120 });
    expect(materialized.actions.actions[0]).toMatchObject({ cooldown_minutes: 120 });
  });
});

describe('template copy', () => {
  it('hands an envelope its own words back, so a $t(...) name never resolves', () => {
    const name = 'Handy policy $t(automations.gallery.builtin)';
    const description = 'Reads $t(automations.gallery.builtin) if i18next ever sees it';

    expect(templateName(t, { slug: 'pasted-one', name })).toBe(name);
    expect(templateDescription(t, { slug: 'pasted-one', description })).toBe(description);
  });

  it('still prefers the catalog copy for a template the app ships', () => {
    expect(templateName(t, { slug: 'stream-started', name: 'whatever the envelope said' })).toBe(
      'Stream started'
    );
  });
});

describe('templateInputLabel', () => {
  it('prefers the wording the app uses when the template names a bare kind', () => {
    const input: TemplateInput = {
      key: 'server',
      kind: 'server',
      label: 'Server',
      required: false,
    };

    expect(templateInputLabel(t, input)).toBe('Which server');
  });

  it('keeps a label that says something of its own', () => {
    const input: TemplateInput = {
      key: 'to',
      kind: 'destinations',
      label: 'Send to',
      required: true,
    };

    expect(templateInputLabel(t, input)).toBe('Send to');
  });
});
