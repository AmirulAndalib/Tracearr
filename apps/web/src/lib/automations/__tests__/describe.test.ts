import { beforeAll, describe, expect, it } from 'vitest';
import { i18n, initI18n } from '@tracearr/translations';
import type { Condition, TemplateInput } from '@tracearr/shared';
import {
  capFragments,
  describeAutomation,
  describeText,
  type DescribableDefinition,
  type DescribeRefs,
} from '../describe';
import { triggerPickerEntries } from '../catalog';
import type { Translate } from '../conditionFields';

let t: Translate;

beforeAll(async () => {
  await initI18n({ lng: 'en' });
  t = i18n.getFixedT(null, 'pages');
});

/** The whole sentence, uncapped, as the builder renders it fragment by fragment. */
function sentence(definition: DescribableDefinition, refs: DescribeRefs = {}): string {
  return describeAutomation(definition, refs, t, 'metric')
    .map((fragment) => fragment.text)
    .join(' ');
}

function conditions(...list: Condition[]): { groups: { conditions: Condition[] }[] } {
  return { groups: [{ conditions: list }] };
}

describe('describeAutomation', () => {
  it('reads the spec grammar example end to end', () => {
    const definition: DescribableDefinition = {
      kind: 'notification',
      triggers: [
        { id: 'trigger-started', type: 'session.started', enabled: true },
        {
          id: 'trigger-paused',
          type: 'session.held_for',
          enabled: true,
          params: { minutes: 30, measure: 'current' },
        },
      ],
      conditions: {
        groups: [
          {
            id: 'group-1',
            match: 'all',
            conditions: [
              { id: 'condition-lan', field: 'is_local_network', operator: 'eq', value: false },
              {
                id: 'condition-transcode',
                field: 'is_transcoding',
                operator: 'eq',
                value: 'video_or_audio',
              },
            ],
          },
        ],
      },
      actions: {
        actions: [
          { id: 'action-send', type: 'send', to: ['destination-1'] },
          {
            id: 'action-if',
            type: 'if',
            conditions: {
              groups: [
                {
                  id: 'group-2',
                  conditions: [
                    { id: 'condition-country', field: 'country', operator: 'neq', value: 'US' },
                  ],
                },
              ],
            },
            then: [{ id: 'action-kill', type: 'kill_stream' }],
            else: [],
          },
        ],
      },
      serverId: 'server-1',
    };

    expect(
      sentence(definition, {
        destinations: { 'destination-1': 'team-discord' },
        servers: { 'server-1': 'Beehive' },
      })
    ).toBe(
      'When a stream starts or a stream has been paused for 30 minutes, only when all of: ' +
        'the user is not on the local network, the stream is transcoding; send to team-discord, ' +
        'then if the country is not US, stop the stream. Otherwise do nothing. Applies to Beehive.'
    );
  });

  it('leaves out every disabled node', () => {
    const definition: DescribableDefinition = {
      kind: 'notification',
      triggers: [
        { id: 'trigger-started', type: 'session.started', enabled: true },
        { id: 'trigger-stopped', type: 'session.stopped', enabled: false },
      ],
      conditions: {
        groups: [
          {
            conditions: [
              { field: 'trust_score', operator: 'lt', value: 50 },
              { field: 'concurrent_streams', operator: 'gt', value: 3, enabled: false },
            ],
          },
          {
            enabled: false,
            conditions: [{ field: 'account_age_days', operator: 'lt', value: 7 }],
          },
        ],
      },
      actions: {
        actions: [
          { type: 'send', to: ['destination-1'] },
          {
            type: 'if',
            conditions: conditions({ field: 'is_local_network', operator: 'eq', value: true }),
            then: [
              { type: 'message_client', message: 'Enjoy' },
              { type: 'kill_stream', enabled: false },
            ],
            else: [],
          },
          { type: 'kill_stream', enabled: false },
        ],
      },
    };

    const text = sentence(definition, { destinations: { 'destination-1': 'team-discord' } });

    expect(text).toBe(
      'When a stream starts, only when the trust score is below 50; send to team-discord, ' +
        'then if the user is on the local network, message the player. Otherwise do nothing.'
    );
    expect(text).not.toContain('a stream stops');
    expect(text).not.toContain('the account age');
    expect(text).not.toContain('stop the stream');
  });

  it('opens a policy sentence with the flag it takes', () => {
    const text = sentence({
      kind: 'policy',
      triggers: [{ id: 'trigger-started', type: 'session.started', enabled: true }],
      conditions: conditions({ field: 'concurrent_streams', operator: 'gt', value: 3 }),
      actions: { actions: [{ type: 'kill_stream' }] },
    });

    expect(text).toBe(
      'When a stream starts, only when the stream count is above 3. Flag it, then stop the stream.'
    );
  });

  it('spells out both branches of an if', () => {
    const text = sentence({
      kind: 'notification',
      triggers: [{ id: 'trigger-started', type: 'session.started', enabled: true }],
      conditions: { groups: [] },
      actions: {
        actions: [
          {
            type: 'if',
            conditions: conditions({ field: 'is_local_network', operator: 'eq', value: true }),
            then: [{ type: 'message_client', message: 'Enjoy' }],
            else: [{ type: 'kill_stream' }],
          },
        ],
      },
    });

    expect(text).toBe(
      'When a stream starts, if the user is on the local network, message the player. ' +
        'Otherwise stop the stream.'
    );
  });

  it('reads a slot nothing has answered as the kind of thing it holds', () => {
    const text = sentence(
      {
        kind: 'notification',
        triggers: [
          {
            id: 'trigger-paused',
            type: 'session.held_for',
            enabled: true,
            params: { minutes: { $input: 'pause' }, measure: 'total' },
          },
        ],
        conditions: { groups: [] },
        actions: { actions: [] },
        scope: { serverId: { $input: 'server' } },
      },
      {},
      { pause: 'duration', server: 'server' }
    );

    expect(text).toBe(
      'When a stream has been paused for whatever you pick in total. Applies to whatever you pick.'
    );
  });

  it('says which way a group matches once it holds more than one condition', () => {
    const text = sentence(
      {
        kind: 'notification',
        triggers: [{ id: 'trigger-started', type: 'session.started', enabled: true }],
        conditions: {
          groups: [
            {
              match: 'any',
              conditions: [
                { field: 'trust_score', operator: 'lt', value: 50 },
                { field: 'country', operator: 'in', value: ['US', 'CA'] },
              ],
            },
          ],
        },
        actions: { actions: [] },
      },
      { countries: { US: 'United States', CA: 'Canada' } }
    );

    expect(text).toBe(
      'When a stream starts, only when any of: the trust score is below 50, ' +
        'the country is one of United States, Canada.'
    );
  });

  it('separates one group from the next even when its list was cut short', () => {
    const text = sentence(
      {
        kind: 'notification',
        triggers: [{ id: 'trigger-started', type: 'session.started', enabled: true }],
        conditions: {
          groups: [
            {
              match: 'any',
              conditions: [{ field: 'country', operator: 'in', value: ['US', 'CA', 'GB', 'DE'] }],
            },
            {
              match: 'all',
              conditions: [{ field: 'trust_score', operator: 'lt', value: 50 }],
            },
          ],
        },
        actions: { actions: [] },
      },
      {
        countries: {
          US: 'United States',
          CA: 'Canada',
          GB: 'United Kingdom',
          DE: 'Germany',
        },
      }
    );

    expect(text).toContain('United States, Canada, United Kingdom...;');
  });

  it('reads a legacy group with no match as any of its conditions', () => {
    const text = sentence({
      kind: 'notification',
      triggers: [{ id: 'trigger-started', type: 'session.started', enabled: true }],
      conditions: conditions(
        { field: 'trust_score', operator: 'lt', value: 50 },
        { field: 'account_age_days', operator: 'lt', value: 7 }
      ),
      actions: { actions: [] },
    });

    expect(text).toContain('only when any of:');
  });

  it('says nothing starts it yet when no trigger is enabled', () => {
    expect(sentence({ kind: 'notification', triggers: [] })).toBe('When nothing yet.');
  });

  it('converts a distance threshold to the reader unit system', () => {
    const definition: DescribableDefinition = {
      kind: 'notification',
      triggers: [{ id: 'trigger-started', type: 'session.started', enabled: true }],
      conditions: conditions({ field: 'active_session_distance_km', operator: 'gt', value: 500 }),
    };

    expect(sentence(definition)).toContain('the distance between streams is above 500 km');
    expect(
      describeAutomation(definition, {}, t, 'imperial')
        .map((fragment) => fragment.text)
        .join(' ')
    ).toContain('the distance between streams is above 311 mi');
  });

  it('describes a field or operator this build retired without throwing', () => {
    const retired = {
      field: 'library_id',
      operator: 'between',
      value: 'lib-4',
    } as unknown as Condition;

    expect(sentence({ kind: 'notification', conditions: conditions(retired) })).toContain(
      'library_id between lib-4'
    );
  });

  it('reads ids as the names the refs carry', () => {
    const text = sentence(
      {
        kind: 'notification',
        conditions: conditions({ field: 'server_id', operator: 'eq', value: 'server-1' }),
        actions: { actions: [{ type: 'send', to: ['destination-1', 'destination-2'] }] },
        serverUserId: 'account-1',
      },
      {
        servers: { 'server-1': 'Beehive' },
        accounts: { 'account-1': 'connor' },
        destinations: { 'destination-1': 'team-discord', 'destination-2': 'ops-email' },
      }
    );

    expect(text).toContain('the server is Beehive');
    expect(text).toContain('send to team-discord, ops-email');
    expect(text).toContain('Applies to connor.');
  });

  it('keeps the node id on every fragment it took from a node', () => {
    const fragments = describeAutomation(
      {
        kind: 'notification',
        triggers: [{ id: 'trigger-started', type: 'session.started', enabled: true }],
        conditions: {
          groups: [
            {
              id: 'group-1',
              match: 'all',
              conditions: [
                { id: 'condition-1', field: 'trust_score', operator: 'lt', value: 50 },
                { id: 'condition-2', field: 'account_age_days', operator: 'lt', value: 7 },
              ],
            },
          ],
        },
        actions: { actions: [{ id: 'action-send', type: 'send', to: [] }] },
      },
      {},
      t,
      'metric'
    );

    expect(fragments.map((fragment) => fragment.nodeId)).toEqual([
      'trigger-started',
      'group-1',
      'condition-1',
      'condition-2',
      'action-send',
    ]);
  });

  it('reads an if with nothing to test as one, not as a dangling comma', () => {
    const half = sentence({
      kind: 'notification',
      triggers: [{ id: 'trigger-started', type: 'session.started', enabled: true }],
      actions: {
        actions: [
          {
            type: 'if',
            conditions: { groups: [] },
            then: [{ type: 'kill_stream' }],
            else: [],
          },
        ],
      },
    });

    expect(half).toBe(
      'When a stream starts, if nothing yet, stop the stream. Otherwise do nothing.'
    );

    const allDisabled = sentence({
      kind: 'notification',
      triggers: [{ id: 'trigger-started', type: 'session.started', enabled: true }],
      actions: {
        actions: [
          {
            type: 'if',
            conditions: {
              groups: [
                {
                  conditions: [{ field: 'trust_score', operator: 'lt', value: 50, enabled: false }],
                },
              ],
            },
            then: [{ type: 'kill_stream' }],
            else: [],
          },
        ],
      },
    });

    expect(allDisabled).toContain('if nothing yet, stop the stream.');
  });

  it('reads a transcoding state in the negative too', () => {
    const text = sentence({
      kind: 'notification',
      triggers: [{ id: 'trigger-started', type: 'session.started', enabled: true }],
      conditions: conditions({ field: 'is_transcoding', operator: 'neq', value: 'video' }),
    });

    expect(text).toContain('the stream is not transcoding video');
  });

  it('separates one condition group from the next with a semicolon', () => {
    const text = sentence({
      kind: 'notification',
      triggers: [{ id: 'trigger-started', type: 'session.started', enabled: true }],
      conditions: {
        groups: [
          {
            match: 'all',
            conditions: [
              { field: 'trust_score', operator: 'lt', value: 50 },
              { field: 'account_age_days', operator: 'lt', value: 7 },
            ],
          },
          {
            match: 'any',
            conditions: [
              { field: 'media_type', operator: 'in', value: ['movie'] },
              { field: 'platform', operator: 'in', value: ['roku'] },
            ],
          },
        ],
      },
    });

    expect(text).toBe(
      'When a stream starts, only when all of: the trust score is below 50, ' +
        'the account age is below 7 days; and also any of: the media type is one of Movie, ' +
        'the platform is one of Roku.'
    );
  });

  it('keeps the note behind a counting param instead of dropping it', () => {
    const text = sentence(
      {
        kind: 'notification',
        triggers: [{ id: 'trigger-started', type: 'session.started', enabled: true }],
        conditions: {
          groups: [
            {
              conditions: [
                {
                  field: 'concurrent_streams',
                  operator: 'gt',
                  value: 3,
                  params: { exclude_same_device: { $input: 'sameDevice' } },
                },
              ],
            },
          ],
        },
      },
      {},
      { sameDevice: 'boolean' }
    );

    expect(text).toContain('the stream count is above 3 (same device: a chosen setting)');
  });
});

describe('capFragments', () => {
  it('keeps what fits and counts the rest in a fragment of its own', () => {
    const fragments = [
      { nodeId: 'a', text: 'x'.repeat(100) },
      { nodeId: 'b', text: 'y'.repeat(50) },
      { nodeId: 'c', text: 'z'.repeat(50) },
    ];

    expect(capFragments(fragments, t)).toEqual([
      { nodeId: 'a', text: 'x'.repeat(100) },
      { nodeId: 'b', text: 'y'.repeat(50) },
      { nodeId: null, text: '+1 more' },
    ]);
  });

  it('keeps a first fragment that runs past the cap on its own', () => {
    const fragments = [{ nodeId: 'a', text: 'x'.repeat(200) }];

    expect(capFragments(fragments, t)).toEqual(fragments);
  });
});

describe('describeText', () => {
  it('joins the fragments into one sentence', () => {
    const fragments = [
      { nodeId: 'trigger-started', text: 'When a stream starts,' },
      { nodeId: 'action-send', text: 'send to team-discord.' },
    ];

    expect(describeText(fragments, t)).toBe('When a stream starts, send to team-discord.');
  });

  it('counts the fragments it drops past 160 characters', () => {
    const fragments = [
      { nodeId: 'a', text: 'x'.repeat(100) },
      { nodeId: 'b', text: 'y'.repeat(50) },
      { nodeId: 'c', text: 'z'.repeat(50) },
      { nodeId: 'd', text: 'w'.repeat(50) },
    ];

    const text = describeText(fragments, t);

    expect(text).toBe(`${'x'.repeat(100)} ${'y'.repeat(50)} +2 more`);
  });
});

describe('the media triggers in the picker and the sentence', () => {
  it('offers both under the Library group with words to search them by', () => {
    const entries = triggerPickerEntries(t);
    const library = entries.filter((entry) => entry.group === 'Library');

    expect(library.map((entry) => entry.value)).toEqual(['media.added', 'media.upgraded']);
    expect(library[0]?.label).toBe('Media is added');
    expect(library[1]?.synonyms).toContain('upgrade');
  });

  it('reads the media-upgraded template as a sentence with its destination slot', () => {
    const fragments = describeAutomation(
      {
        kind: 'notification',
        triggers: [{ id: 'trigger-upgraded', type: 'media.upgraded', enabled: true }],
        conditions: { groups: [] },
        actions: { actions: [{ id: 'action-send', type: 'send', to: { $input: 'to' } }] },
        inputs: [{ key: 'to', label: 'Send to' }],
      },
      {},
      t,
      'metric'
    );

    expect(describeText(fragments, t)).toBe('When media is upgraded, send to [Send to].');
  });

  it('names the library and the resolution a media condition reads', () => {
    const text = sentence({
      kind: 'notification',
      triggers: [{ id: 'trigger-added', type: 'media.added', enabled: true }],
      conditions: conditions(
        { field: 'library_name', operator: 'eq', value: 'Movies' },
        { field: 'resolution_after', operator: 'gte', value: '4K' }
      ),
      actions: { actions: [] },
    });

    expect(text).toContain('the library is Movies');
    expect(text).toContain('the resolution is at least 4K');
  });
});
