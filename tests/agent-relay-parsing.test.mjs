// What the relay reads out of a note: which commit to review, who owes the next reply, and
// whether the note is still the one that was scanned.
//
// Both of these decide where a round is pointed, and both were wrong in ways that no run of
// --selftest could have shown — the selftest writes its own note, so it never contains a
// quoted example, a signature from a third name, or a fenced code block. Every case below is
// one that was actually got wrong, or the regression that proves the fix did not overshoot.
//
// The functions are read out of tools/agent-relay.mjs rather than imported, because importing
// that file runs the CLI. The slice is the block between two comments; if it stops matching,
// this test fails loudly rather than silently checking nothing.

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

// The second slice is the note-identity pair: the canonical hash, and the check that asks
// whether the file on disk is still what scan() saw.
const cFrom = src.indexOf('const hash = s => createHash');
const cTo = src.indexOf('// ── end still-current ──');
if (cFrom === -1 || cTo === -1 || cTo <= cFrom) {
  console.error('✗ could not find the still-current block in tools/agent-relay.mjs — this test is checking nothing.');
  process.exit(1);
}
const { hash, stillCurrent, isClosed } = eval(
  `(function () { ${src.slice(from, to)}; ${src.slice(cFrom, cTo)}; return { hash, stillCurrent, isClosed }; })()`);

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

// ── is this still the note that was scanned? ────────────────────────────────

// A pass photographs every note up front and can then spend twenty minutes on the first one.
// Anything it dispatches afterwards has to be re-checked, or a note edited in that window is
// answered under the old routing and dispatched again on the next pass.
const tmp = mkdtempSync(join(tmpdir(), 'relay-still-current-'));
try {
  const path = join(tmp, 'note.md');
  const text = ['# שאלה', '', 'גוף הפתק'].join(NL);
  writeFileSync(path, text);
  const scanned = { path, hash: hash(text) };

  check('an untouched note is still the one that was scanned', stillCurrent(scanned), true);

  writeFileSync(path, text + NL + 'שורה שנוספה תוך כדי');
  check('a note edited since the scan is not dispatched under the old reading',
    stillCurrent(scanned), false);

  // Line endings are not an edit anywhere else in the relay, and must not be one here: git
  // rewrites them on checkout, and a note that lost its turn to that would never be answered.
  writeFileSync(path, text.split(NL).join(String.fromCharCode(13, 10)));
  check('a checkout that only changed line endings is not an edit', stillCurrent(scanned), true);

  rmSync(path);
  check('a note deleted since the scan is not dispatched', stillCurrent(scanned), false);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}


// ── has this thread finished? ───────────────────────────────────────────────

// Without a way to say "settled", a thread only stopped by running out of rounds — a
// budget, not a conclusion — so a finished exchange kept waking both agents, and a
// watcher could not tell "done" from "still going".
const closedNote = ['# כותרת', '', 'מצב: **נסגר.** מוזג ל-main.', '', '---', '', 'גוף'].join(NL);
check('a note whose status opens with נסגר is closed', isClosed(closedNote), true);
check('סגור closes it too', isClosed(['מצב: סגור', '', '---'].join(NL)), true);
check('and so does the English', isClosed(['status: closed', '', '---'].join(NL)), true);

// Every real note in agents/ carries a status line, and none of them means finished.
check('an open note is not closed', isClosed(['מצב: **פתוח. לא נגעתי בקוד.**', '', '---'].join(NL)), false);
check('nor is one that merely mentions a merge',
  isClosed(['מצב: **על ענף fix/x. לא מוזג.**', '', '---'].join(NL)), false);
check('nor one with no status line at all', isClosed(['# כותרת', '', '---'].join(NL)), false);

// The word has to be the status, not something the note talks about.
check('a body that discusses closing does not close the thread',
  isClosed(['מצב: פתוח', '', '---', '', 'כשזה ייסגר נכתוב מצב: נסגר'].join(NL)), false);
check('and neither does a quoted example',
  isClosed(['# כותרת', FENCE, 'מצב: נסגר', FENCE, '', '---'].join(NL)), false);
console.log(failed ? `${NL}✗ ${failed} failed` : `${NL}✓ agent-relay parsing: all checks passed`);
process.exit(failed ? 1 : 0);
