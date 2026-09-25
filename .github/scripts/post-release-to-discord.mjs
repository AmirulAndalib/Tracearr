import { readFileSync } from 'node:fs';

const {
  DISCORD_BOT_TOKEN: botToken,
  DISCORD_ANNOUNCEMENTS_CHANNEL_ID: channelId,
  DISCORD_NO_MENTIONS: noMentions,
  DISCORD_RELEASE_ROLE_ID: releaseRoleId,
  DISCORD_BETA_ROLE_ID: betaRoleId,
  RELEASE_TAG: tag,
  NOTES_FILE: notesFile,
  PRERELEASE: prerelease,
  DRY_RUN: dryRun,
} = process.env;

if (!tag || !notesFile) {
  console.error('RELEASE_TAG and NOTES_FILE are required');
  process.exit(1);
}

const RELEASE_URL = `https://github.com/connorgallopo/Tracearr/releases/tag/${tag}`;
const DOCS_URL = 'https://docs.tracearr.com';
const DISCORD_URL = 'https://discord.gg/a7n3sFd2Yw';
// The same hosted icon the app's own Discord notifications use.
const LOGO_URL =
  'https://raw.githubusercontent.com/connorgallopo/Tracearr/main/apps/web/public/web-app-manifest-192x192-transparent.png';
const ACCENT = 0x3498db;
const IS_COMPONENTS_V2 = 1 << 15;
// Component type ids and the link button style, from the Components reference.
const ACTION_ROW = 1;
const BUTTON = 2;
const SECTION = 9;
const TEXT = 10;
const THUMBNAIL = 11;
const SEPARATOR = 14;
const CONTAINER = 17;
const LINK_STYLE = 5;
// The Components reference caps a message at 40 components and a button label at 80 characters.
const MAX_COMPONENTS = 40;
const MAX_BUTTON_LABEL = 80;

/**
 * @typedef {{ type: string; text: string; refs?: string[] }} Change
 * @typedef {{ title: string; body: string; docs?: string }} Highlight
 * @typedef {{ headline?: string; upgradeWarning?: string; highlights?: Highlight[]; changes?: Change[] }} Notes
 */
/** @type {Notes} */
const notes = JSON.parse(readFileSync(notesFile, 'utf8'));
const version = tag.replace(/^v/, '');
const isPrerelease = prerelease === 'true';

const SECTION_LABELS = {
  new: ['new', 'new'],
  improved: ['improved', 'improved'],
  fix: ['fix', 'fixes'],
  security: ['security fix', 'security fixes'],
  note: ['note', 'notes'],
};
const counts = {};
for (const change of notes.changes ?? []) counts[change.type] = (counts[change.type] ?? 0) + 1;
const countsLine = Object.entries(SECTION_LABELS)
  .filter(([type]) => counts[type])
  .map(([type, [one, many]]) => `${counts[type]} ${counts[type] === 1 ? one : many}`)
  .join(' · ');

const text = (content) => ({ type: TEXT, content });
const separator = (divider) => ({ type: SEPARATOR, divider, spacing: 1 });
const highlightBlock = (highlight) =>
  text(
    `### ${highlight.title}\n${highlight.body}${highlight.docs ? ` [Docs](${highlight.docs})` : ''}`
  );
const changeLine = (change) => {
  let line = `- ${change.text}`;
  if (change.refs?.length) line += ` (${change.refs.join(', ')})`;
  return line;
};

// Stable releases page everyone plus the release alerts role; betas page the beta role only.
// DISCORD_NO_MENTIONS posts the card silently, for a test run.
const roleId = isPrerelease ? betaRoleId : releaseRoleId;
const mentionLine = noMentions
  ? ''
  : [!isPrerelease && '@everyone', roleId && `<@&${roleId}>`].filter(Boolean).join(' ');
const allowedMentions = noMentions
  ? { parse: [] }
  : {
      ...(isPrerelease ? {} : { parse: ['everyone'] }),
      ...(roleId ? { roles: [roleId] } : {}),
    };

const blocks = [];
const title = `## Tracearr v${version}`;
const subtitle = isPrerelease ? 'Beta release' : notes.headline;
blocks.push({
  type: SECTION,
  components: [text(subtitle ? `${title}\n${subtitle}` : title)],
  accessory: { type: THUMBNAIL, media: { url: LOGO_URL } },
});
if (notes.upgradeWarning) blocks.push(text(`**${notes.upgradeWarning}**`));
blocks.push(separator(true));

if (isPrerelease) {
  // Every beta posts the whole file, so the card stays short and points at the release.
  blocks.push(text(countsLine || 'Release notes on GitHub'));
} else if (notes.highlights?.length) {
  notes.highlights.forEach((highlight, index) => {
    if (index > 0) blocks.push(separator(false));
    blocks.push(highlightBlock(highlight));
  });
  blocks.push(separator(true));
  blocks.push(text(countsLine));
} else {
  // Patch releases carry no highlights and a short list, so the list itself is the card.
  const list = (notes.changes ?? []).map(changeLine).join('\n');
  blocks.push(text(list || countsLine));
}

blocks.push({
  type: ACTION_ROW,
  components: [
    { type: BUTTON, style: LINK_STYLE, label: 'Release notes', url: RELEASE_URL },
    { type: BUTTON, style: LINK_STYLE, label: 'Docs', url: DOCS_URL },
    { type: BUTTON, style: LINK_STYLE, label: 'Discord', url: DISCORD_URL },
  ],
});

const components = [
  ...(mentionLine ? [text(mentionLine)] : []),
  { type: CONTAINER, accent_color: ACCENT, components: blocks },
];

const flatten = (list) => list.flatMap((block) => [block, ...flatten(block.components ?? [])]);
const all = flatten(components);
if (all.length > MAX_COMPONENTS) {
  console.error(
    `Card has ${all.length} components, over Discord's ${MAX_COMPONENTS}; trim the notes`
  );
  process.exit(1);
}
const longLabel = all.find(
  (block) => block.type === BUTTON && block.label.length > MAX_BUTTON_LABEL
);
if (longLabel) {
  console.error(`Button label "${longLabel.label}" is over ${MAX_BUTTON_LABEL} characters`);
  process.exit(1);
}

const payload = {
  flags: IS_COMPONENTS_V2,
  components,
  allowed_mentions: allowedMentions,
};

if (dryRun) {
  console.log(`[dry-run] ${tag} (${all.length} components)\n${JSON.stringify(payload, null, 2)}`);
  process.exit(0);
}

if (!botToken || !channelId) {
  console.log('Discord bot token or channel not configured - skipping announcement post');
  process.exit(0);
}

const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
  method: 'POST',
  headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
if (!response.ok) {
  console.error(`Discord post failed (${response.status}):`, await response.text());
  process.exit(1);
}
const message = await response.json();
console.log(`Posted to Discord: message ${message.id ?? '(no id returned)'}`);
