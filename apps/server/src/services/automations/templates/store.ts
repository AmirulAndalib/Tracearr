/**
 * Reads and writes for the template catalog: the envelope rows, their immutable
 * versions, and the automations bound to them.
 */

import { createHash } from 'node:crypto';
import { and, count, eq, like, sql } from 'drizzle-orm';
import {
  fingerprintOf,
  materializeTemplate,
  type AutomationKind,
  type TEMPLATE_GROUPS,
  type TemplateDefinition,
  type TemplateEnvelope,
  type TemplateInput,
  type ViolationSeverity,
} from '@tracearr/shared';
import { db, type Executor } from '../../../db/client.js';
import {
  automations,
  automationTemplates,
  automationTemplateVersions,
  servers,
} from '../../../db/schema.js';
import {
  automationDefinition,
  insertAutomationVersion,
  storedSeverity,
  type AutomationRow,
} from '../versions.js';

export type TemplateSource = 'builtin' | 'import' | 'local';

export interface TemplateSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  group: (typeof TEMPLATE_GROUPS)[number];
  kind: AutomationKind;
  builtin: boolean;
  source: TemplateSource;
  author: string | null;
  currentVersion: number;
  usedBy: number;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateVersionPayload {
  version: number;
  inputs: TemplateInput[];
  definition: TemplateDefinition;
}

/** An envelope whose body no longer hashes to the fingerprint it carries. */
export class TemplateFingerprintError extends Error {
  constructor(
    readonly declared: string,
    readonly computed: string
  ) {
    super(`envelope fingerprint ${declared} does not match its contents (${computed})`);
    this.name = 'TemplateFingerprintError';
  }
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** An explicit null clears the field; leaving it out keeps whatever the template supplied. */
const overridden = <T>(override: T | null | undefined, supplied: T | null): T | null =>
  override !== undefined ? override : supplied;

/** A passed-in executor is already the caller's transaction; only a bare `db` needs one opened. */
const inTransaction = <T>(executor: Executor, run: (tx: Executor) => Promise<T>): Promise<T> =>
  executor === db ? db.transaction(run) : run(executor);

// Written out rather than interpolated: drizzle emits a bare "id" for the column,
// which the subquery would resolve against `automations` instead of the outer row.
const usedByColumn = sql<number>`(SELECT count(*)::int FROM automations a WHERE a.template_id = automation_templates.id)`;

const summaryColumns = {
  id: automationTemplates.id,
  slug: automationTemplates.slug,
  name: automationTemplates.name,
  description: automationTemplates.description,
  group: automationTemplates.group,
  kind: automationTemplates.kind,
  builtin: automationTemplates.builtin,
  source: automationTemplates.source,
  author: automationTemplates.author,
  currentVersion: automationTemplates.currentVersion,
  usedBy: usedByColumn,
  createdAt: automationTemplates.createdAt,
  updatedAt: automationTemplates.updatedAt,
};

type SummaryRow = Omit<TemplateSummary, 'createdAt' | 'updatedAt'> & {
  createdAt: Date;
  updatedAt: Date;
};

const toSummary = (row: SummaryRow): TemplateSummary => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export async function listTemplates(executor: Executor = db): Promise<TemplateSummary[]> {
  const rows = await executor
    .select(summaryColumns)
    .from(automationTemplates)
    .orderBy(automationTemplates.name);
  return rows.map(toSummary);
}

export async function getTemplate(
  id: string,
  executor: Executor = db
): Promise<(TemplateSummary & { version: TemplateVersionPayload }) | null> {
  const rows = await executor
    .select({
      ...summaryColumns,
      version: automationTemplateVersions.version,
      inputs: automationTemplateVersions.inputs,
      definition: automationTemplateVersions.definition,
    })
    .from(automationTemplates)
    .innerJoin(
      automationTemplateVersions,
      and(
        eq(automationTemplateVersions.templateId, automationTemplates.id),
        eq(automationTemplateVersions.version, automationTemplates.currentVersion)
      )
    )
    .where(eq(automationTemplates.id, id));
  const row = rows[0];
  if (!row) return null;
  const { version, inputs, definition, ...summary } = row;
  return { ...toSummary(summary), version: { version, inputs, definition } };
}

export async function getTemplateVersion(
  id: string,
  version: number
): Promise<TemplateVersionPayload | null> {
  const rows = await db
    .select({
      version: automationTemplateVersions.version,
      inputs: automationTemplateVersions.inputs,
      definition: automationTemplateVersions.definition,
    })
    .from(automationTemplateVersions)
    .where(
      and(
        eq(automationTemplateVersions.templateId, id),
        eq(automationTemplateVersions.version, version)
      )
    );
  return rows[0] ?? null;
}

/** The first `<slug>`, `<slug>-2`, `<slug>-3`… nothing has claimed yet. */
async function freeSlug(executor: Executor, base: string): Promise<string> {
  const rows = await executor
    .select({ slug: automationTemplates.slug })
    .from(automationTemplates)
    .where(like(automationTemplates.slug, `${base}%`));
  const taken = new Set(rows.map((row) => row.slug));
  let candidate = base;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${base}-${n}`;
  return candidate;
}

async function appendVersion(
  executor: Executor,
  templateId: string,
  version: number,
  envelope: TemplateEnvelope
): Promise<void> {
  await executor.insert(automationTemplateVersions).values({
    templateId,
    version,
    inputs: envelope.inputs,
    definition: envelope.definition,
    fingerprint: envelope.fingerprint,
  });
}

/**
 * An import lands on the template it matches, on the one it replaces, or on a new
 * row with a free slug; a builtin slug is never taken over. A `replaceId` naming a
 * builtin, a missing row, or a row under another slug falls through to that new row.
 */
export async function createTemplate(
  envelope: TemplateEnvelope,
  opts: { source: 'import' | 'local'; replaceId?: string },
  executor: Executor = db
): Promise<{ id: string; version: number; created: boolean }> {
  const computed = fingerprintOf(envelope, sha256Hex);
  if (computed !== envelope.fingerprint) {
    throw new TemplateFingerprintError(envelope.fingerprint, computed);
  }

  const fields = {
    name: envelope.name,
    description: envelope.description,
    group: envelope.group,
    kind: envelope.kind,
    author: envelope.author ?? null,
    minServerVersion: envelope.minServerVersion,
    fingerprint: envelope.fingerprint,
  };

  return inTransaction(executor, async (tx) => {
    if (opts.replaceId) {
      const target = (
        await tx
          .select()
          .from(automationTemplates)
          .where(eq(automationTemplates.id, opts.replaceId))
      )[0];
      if (target && !target.builtin && target.slug === envelope.slug) {
        if (target.fingerprint === envelope.fingerprint) {
          return { id: target.id, version: target.currentVersion, created: false };
        }
        const version = target.currentVersion + 1;
        await appendVersion(tx, target.id, version, envelope);
        await tx
          .update(automationTemplates)
          .set({ ...fields, source: opts.source, currentVersion: version, updatedAt: new Date() })
          .where(eq(automationTemplates.id, target.id));
        return { id: target.id, version, created: false };
      }
    }

    const existing = (
      await tx.select().from(automationTemplates).where(eq(automationTemplates.slug, envelope.slug))
    )[0];
    if (existing?.fingerprint === envelope.fingerprint) {
      return { id: existing.id, version: existing.currentVersion, created: false };
    }

    const inserted = await tx
      .insert(automationTemplates)
      .values({
        ...fields,
        slug: existing ? await freeSlug(tx, envelope.slug) : envelope.slug,
        builtin: false,
        source: opts.source,
        currentVersion: 1,
      })
      .returning({ id: automationTemplates.id });
    const row = inserted[0];
    if (!row) throw new Error(`failed to store template ${envelope.slug}`);
    await appendVersion(tx, row.id, 1, envelope);
    return { id: row.id, version: 1, created: true };
  });
}

/** A template nothing points at goes; the automations bound to one keep it alive. */
export async function deleteTemplate(
  id: string
): Promise<'deleted' | 'builtin' | { usedBy: number; names: string[] }> {
  return db.transaction(async (tx) => {
    const target = (
      await tx.select().from(automationTemplates).where(eq(automationTemplates.id, id))
    )[0];
    // A template that is already gone reads as deleted; the caller wanted it absent.
    if (!target) return 'deleted';
    if (target.builtin) return 'builtin';

    const bound = await tx
      .select({ name: automations.name })
      .from(automations)
      .where(eq(automations.templateId, id))
      .limit(5);
    if (bound.length > 0) {
      const total = await tx
        .select({ total: count() })
        .from(automations)
        .where(eq(automations.templateId, id));
      return { usedBy: total[0]?.total ?? bound.length, names: bound.map((row) => row.name) };
    }

    await tx.delete(automationTemplates).where(eq(automationTemplates.id, id));
    return 'deleted';
  });
}

/** The displayed default names the server the instance is pinned to; exports never carry it. */
async function defaultName(
  executor: Executor,
  templateName: string,
  serverId: string | null | undefined
): Promise<string> {
  if (!serverId) return templateName;
  const rows = await executor
    .select({ name: servers.name })
    .from(servers)
    .where(eq(servers.id, serverId));
  const server = rows[0];
  return server ? `${templateName} — ${server.name}` : templateName;
}

export interface InstanceOverrides {
  name?: string;
  isActive?: boolean;
  severity?: ViolationSeverity | null;
  cooldownMinutes?: number | null;
  retentionDays?: number | null;
}

/**
 * Bind a template's inputs into an automation row. Node ids come from the envelope,
 * so nothing here re-stamps or re-synthesizes what the template already decided.
 */
export async function instantiateTemplate(
  tx: Executor,
  templateId: string,
  inputs: Record<string, unknown>,
  overrides: InstanceOverrides
): Promise<AutomationRow> {
  const template = await getTemplate(templateId, tx);
  if (!template) throw new Error(`template ${templateId} has no current version`);

  const serverKey = template.version.inputs.find((input) => input.kind === 'server')?.key;
  const boundServer = serverKey === undefined ? undefined : inputs[serverKey];
  const name =
    overrides.name ??
    (await defaultName(
      tx,
      template.name,
      typeof boundServer === 'string' ? boundServer : undefined
    ));

  const created = materializeTemplate(template.version, inputs, { name });
  const inserted = await tx
    .insert(automations)
    .values({
      name: created.name,
      description: template.description,
      kind: created.kind,
      severity: storedSeverity(overridden(overrides.severity, created.severity)),
      triggers: created.triggers ?? [],
      conditions: created.conditions,
      actions: created.actions,
      serverId: created.serverId,
      serverUserId: created.serverUserId,
      userId: created.userId,
      enforceAcrossServers: created.enforceAcrossServers,
      cooldownMinutes: overridden(overrides.cooldownMinutes, created.cooldownMinutes ?? null),
      // Templates carry no retention of their own, so an absent override falls to the kind default.
      retentionDays: overridden(overrides.retentionDays, null),
      isActive: overrides.isActive,
      templateId: template.id,
      templateVersion: template.version.version,
      templateInputs: inputs,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error(`failed to instantiate template ${templateId}`);
  await insertAutomationVersion(tx, row.id, automationDefinition(row));
  return row;
}
