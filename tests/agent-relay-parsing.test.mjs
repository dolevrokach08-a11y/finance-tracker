// What the relay reads out of a note: which commit to review, and who owes the next reply.
//
// Both of these decide where a round is pointed, and both were wrong in ways that no run of
// --selftest could have shown — the selftest writes its own note, so it never contains a
// quoted example, a signature from a third name, or a fenced code block. Every case below is
// one that was actually got wrong, or the regression that proves the fix did not overshoot.
//
// The functions are read out of tools/agent-relay.mjs rather than imported, because importing
// that file runs the CLI. The slice is the block between two comments; if it stops matching,
// this test fails loudly rather than silently checking nothing.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NL = String.fromCharCode(10);
const FENCE = String.fromCharCode(96, 96, 96);

const src = readFileSync(join(ROOT, 'tools', 'agent-relay.mjs'), 'utf8');
const from = src.indexOf('const REPLY_HEADING');
const to = src.indexOf('// How many times one thread');
if (from === -1 || to === -1 || to <= from) {
  console.error('✗ could not find the parsing block in tools/agent-relay.mjs — this test is checking nothing.');
  process.exit(1);
}

// eslint-disable-next-line no-unused-vars — the slice closes over these
const LANES = { 'from-gpt': { owes: 'claude' }, 'from-claude': { owes: 'codex' } };
const sh = () => { throw new Error('not available in this test'); };
const { metaFor, owedBy } = eval(`(function () { ${src.slice(from, to)}; return { metaFor, owedBy }; })()`);

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `   got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

// ── which commit the round is built from ────────────────────────────────────

// Codex's counter-example: a note carrying one commit in its header and another inside a
// fenced example resolved to the quoted one, and would have sent the round to other code.
check('a commit quoted inside a code fence does not win',
  metaFor([
    'review_commit: 2b59e82', '', '---', '', 'body',
    FENCE, 'review_commit: 3c6b5b9', FENCE,
  ].join(NL)).review_commit,
  '2b59e82');

check('two different values for one key are refused, not resolved',
  !!metaFor(['review_commit: 2b59e82', 'review_commit: 3c6b5b9', '', '---'].join(NL)).conflict,
  true);

check('base_commit with nothing to check out is refused',
  !!metaFor(['base_commit: 3c6b5b9', '', '---'].join(NL)).conflict,
  true);

const both = metaFor(['review_commit: 2b59e82', 'base_commit: 3c6b5b9', '', '---'].join(NL));
check('an ordinary header is read whole',
  [both.review_commit, both.base_commit, !!both.conflict],
  ['2b59e82', '3c6b5b9', false]);

check('a note with no metadata asks for nothing',
  metaFor(['# כותרת', '', 'טקסט', '', '---'].join(NL)),
  {});

check('a value that is not a commit id is not read as one',
  metaFor(['review_commit: zzzzzzz', '', '---'].join(NL)),
  {});

// ── who owes the next reply ─────────────────────────────────────────────────

// The folder only says who owed the first reply. After that the thread is one file that both
// agents write into, so the last signature decides — otherwise the relay wakes whoever just
// answered and asks them to answer themselves.
check('a fresh note is owed by the other side', owedBy('# שאלה' + NL, 'from-gpt'), 'claude');
check('a fresh note the other way', owedBy('# שאלה' + NL, 'from-claude'), 'codex');
check('after Codex replies, Claude owes', owedBy('# ש' + NL + '## תגובה — Codex' + NL, 'from-claude'), 'claude');
check('after Claude replies, Codex owes', owedBy('# ש' + NL + '## תגובה — Claude' + NL, 'from-gpt'), 'codex');
check('only the last signature counts',
  owedBy('# ש' + NL + '## תגובה — Codex' + NL + '## תגובה — Claude' + NL, 'from-claude'),
  'codex');

// Codex's second counter-example. AGENTS.md and the folder names both say "GPT", and there is
// a reply signed that way in agents/archive/; reading it as an unknown name sent the thread
// back to the agent that had just written it.
check('a reply signed GPT is Codex', owedBy('# ש' + NL + '## תגובה — GPT, 2026-08-30' + NL, 'from-claude'), 'claude');
check('a reply signed ChatGPT is Codex', owedBy('# ש' + NL + '## תגובה — ChatGPT' + NL, 'from-claude'), 'claude');

check('a reply heading inside a code fence is an example, not a reply',
  owedBy(['# ש', FENCE, '## תגובה — Claude', FENCE].join(NL), 'from-claude'),
  'codex');

check('a תוספת counts as writing in the thread',
  owedBy('# ש' + NL + '## תוספת — Claude, 2026-09-04' + NL, 'from-gpt'),
  'codex');

console.log(failed ? `${NL}✗ ${failed} failed` : `${NL}✓ agent-relay parsing: all checks passed`);
process.exit(failed ? 1 : 0);
