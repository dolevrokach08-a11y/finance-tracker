// Wakes the other agent when a note appears for it, so Dolev stops being the messenger.
//
// What it does NOT do is the point. It does not merge, push, or touch main, and the agent
// it wakes is asked to review and reply — not to implement. That split comes straight from
// the tally in AGENTS.md: cross-agent review catches things wrong in the artifact, and a
// human catches things wrong in the judgment about what to show. Automating the first does
// not let anyone skip the second, so a relayed round ends at "ready for approval", on a
// branch, with Dolev told what happened.
//
// Flow, per pass:
//   agents/from-gpt/*.md     changed  ->  Claude owes a reply
//   agents/from-claude/*.md  changed  ->  Codex owes a reply
//
// A note is dispatched once, keyed by the hash of its contents, so an unchanged file does
// not wake anyone twice and an edited one does. Work happens in a throwaway git worktree,
// which is the real containment; the tool allowlist below is defence in depth, not the
// boundary. State lives in .agent-relay-state.json, untracked, because "which notes has
// this machine dispatched" is a fact about this machine.
//
// Usage:
//   node tools/agent-relay.mjs --status        what is pending, dispatch nothing
//   node tools/agent-relay.mjs --once          one pass
//   node tools/agent-relay.mjs --watch [secs]  poll (default 120)
//   node tools/agent-relay.mjs --reset         forget dispatch history
//
// Run it from your own terminal, not from inside an agent session. A first end-to-end
// attempt got as far as building the worktree and launching the CLI and then failed on
// "OAuth session expired and could not be refreshed" — a child process spawned from within
// a session does not inherit a refreshable login. Nothing else about the pass was wrong:
// the failure was reported, the note was left undispatched so it retries, and no branch
// was left behind. If a plain terminal hits the same wall, the CLI needs its own
// credentials, which is a decision for Dolev and not something this file should reach for.
//
// To smoke-test it, drop a short note in agents/from-gpt/ asking for one checkable claim
// to be verified, run --once, and look for a relay/ branch with a commit on it.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, '.agent-relay-state.json');
const WORKTREES = join(ROOT, '.relay', 'worktrees');

// Who answers a note left in which directory, and how to wake them.
const LANES = {
  'from-gpt': { owes: 'claude', bin: 'claude' },
  'from-claude': { owes: 'codex', bin: 'codex' },
};

// How many times one thread may bounce automatically. A conversation that has gone five
// rounds without a person in it has stopped converging.
const MAX_ROUNDS = 5;

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts }).trim();

// Resolve the binary to a path rather than asking whether it runs. Under `shell: true` a
// missing command and a command that exits 1 are indistinguishable — the first version of
// this reported codex as present when it is not installed. Resolving also removes the need
// for a shell at spawn time, and with it the hazard of passing a multi-line Hebrew brief
// through string concatenation.
function resolveBin(bin) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(finder, [bin], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const first = (r.stdout || '').split('\n').map(l => l.trim()).filter(Boolean)[0];
  return first || null;
}

// A .cmd or .bat shim cannot be executed directly by Node, but it can be handed to cmd.exe
// as a separate argument, which still keeps the brief out of a concatenated string.
function launch(binPath, args, opts) {
  if (/\.(cmd|bat)$/i.test(binPath)) {
    return spawnSync(process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', binPath, ...args], opts);
  }
  return spawnSync(binPath, args, opts);
}

const hash = s => createHash('sha256').update(s).digest('hex').slice(0, 16);

const loadState = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { notes: {} });
const saveState = st => writeFileSync(STATE, JSON.stringify(st, null, 2) + '\n');

function scan() {
  const found = [];
  for (const [dir, lane] of Object.entries(LANES)) {
    const abs = join(ROOT, 'agents', dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs).filter(f => f.endsWith('.md'))) {
      const path = join(abs, name);
      found.push({ dir, name, path, lane, hash: hash(readFileSync(path, 'utf8')) });
    }
  }
  return found;
}

// The instruction the woken agent runs under. It restates the protocol rather than assuming
// the agent will recall it, and it is explicit that the round ends at a reply.
const briefFor = note => `
קרא את \`agents/${note.dir}/${note.name}\` והגב עליו.

**התפקיד שלך בסבב הזה הוא לסקור ולענות, לא ליישם.** אל תשנה קוד מחוץ ל-\`agents/\`.

עבוד לפי הסעיף "איך טענה הופכת למוסכמת" ב-\`AGENTS.md\`:

1. אם הפתק טוען טענה מספרית — **חשב אותה מחדש בעצמך מהמקורות**, אל תסתמך על הדיף.
   מותר וכדאי להריץ \`node tests/*.mjs\` ואת הכלים ב-\`tools/\`.
2. **נסה להפריך.** חפש דוגמה נגדית. **וכתוב מה ניסית שלא הפריך** — זה מה שחוסך לצד
   השני לחזור על אותה דרך.
3. אם אין לך ראיה חיצונית — אמור שאין. שני סוכנים שמסכימים אינם ראיה.
4. אם אתה חולק — אמור במפורש איפה, ולמה.

**כתוב את התשובה בתחתית אותו קובץ**, תחת כותרת \`## תגובה — <שמך>, ${new Date().toISOString().slice(0, 10)}\`,
ואז \`git add\` ו-\`git commit\` בענף הנוכחי בלבד.

**אסור:** \`git push\`, \`git merge\`, מעבר ל-\`main\`, כל פעולה מול GitHub, ושינוי קוד
מחוץ ל-\`agents/\`. הסבב נגמר ב"מוכן לאישור" — דולב מאשר, לא אתה.
`.trim();

// Read, search, reason, run the repo's own checks, and commit inside the worktree. No push,
// no merge, no gh. The worktree is what actually contains this; the list narrows the blast
// radius inside it.
const ALLOWED = [
  'Read', 'Glob', 'Grep', 'Edit', 'Write',
  'Bash(node:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)',
  'Bash(git add:*)', 'Bash(git commit:*)',
];
const DISALLOWED = [
  'Bash(git push:*)', 'Bash(git merge:*)', 'Bash(git switch:*)', 'Bash(git checkout:*)',
  'Bash(gh:*)', 'Bash(npm:*)', 'Bash(curl:*)', 'WebFetch',
];

function dispatch(note, round) {
  const lane = LANES[note.dir];
  const binPath = resolveBin(lane.bin);
  if (!binPath) {
    return { ok: false, reason: `${lane.bin} is not installed here — this one still needs relaying by hand.` };
  }

  const slug = basename(note.name, '.md').slice(0, 40).replace(/[^a-zA-Z0-9-]/g, '-');
  const branch = `relay/${slug}`;
  const dir = join(WORKTREES, slug);

  mkdirSync(WORKTREES, { recursive: true });
  rmSync(dir, { recursive: true, force: true });
  try { sh('git', ['worktree', 'prune']); } catch { /* nothing to prune */ }
  try { sh('git', ['branch', '-D', branch]); } catch { /* no such branch yet */ }
  sh('git', ['worktree', 'add', '-b', branch, dir, 'main']);

  const res = launch(binPath, [
    '--print', briefFor(note),
    '--permission-mode', 'acceptEdits',
    '--allowedTools', ...ALLOWED,
    '--disallowedTools', ...DISALLOWED,
  ], { cwd: dir, encoding: 'utf8', timeout: 20 * 60 * 1000 });

  const wrote = (() => {
    try { return sh('git', ['log', '--oneline', `main..${branch}`], { cwd: dir }); }
    catch { return ''; }
  })();

  return {
    ok: res.status === 0 && !!wrote,
    branch, dir, round,
    commits: wrote,
    output: (res.stdout || res.stderr || '').trim().slice(-1200),
  };
}

function pass({ act }) {
  const st = loadState();
  const notes = scan();
  const pending = notes.filter(n => (st.notes[n.path]?.hash) !== n.hash);

  if (!pending.length) {
    console.log('· nothing new — every note has been dispatched at its current contents.');
    return st;
  }

  for (const note of pending) {
    const prev = st.notes[note.path] || { rounds: 0 };
    const round = prev.rounds + 1;
    const lane = LANES[note.dir];
    console.log(`\n→ ${note.dir}/${note.name}`);
    console.log(`  owed by: ${lane.owes}   round: ${round}`);

    if (round > MAX_ROUNDS) {
      console.log(`  ✗ stopping: ${MAX_ROUNDS} automatic rounds already. This one needs a person.`);
      st.notes[note.path] = { ...prev, hash: note.hash, stalled: true };
      continue;
    }
    if (!act) { console.log('  (status only — not dispatched)'); continue; }

    const r = dispatch(note, round);
    if (!r.ok) {
      console.log(`  ✗ ${r.reason || 'the agent produced no commit'}`);
      if (r.output) console.log(r.output.split('\n').map(l => '    ' + l).join('\n'));
      // Not marked as dispatched: a failed wake should be retried, not swallowed.
      continue;
    }
    console.log(`  ✓ replied on ${r.branch}`);
    console.log(`    ${r.commits.split('\n').join('\n    ')}`);
    console.log(`    review: git log -p main..${r.branch}`);
    st.notes[note.path] = { hash: note.hash, rounds: round, branch: r.branch, at: new Date().toISOString() };
  }

  saveState(st);
  return st;
}

const argv = process.argv.slice(2);
const has = f => argv.includes(f);

if (has('--reset')) {
  rmSync(STATE, { force: true });
  console.log('✓ dispatch history forgotten.');
} else if (has('--watch')) {
  const secs = Number(argv[argv.indexOf('--watch') + 1]) || 120;
  console.log(`agent-relay: watching agents/ every ${secs}s. Nothing is merged or pushed. Ctrl-C to stop.`);
  const tick = () => { try { pass({ act: true }); } catch (e) { console.error('✗', e.message); } };
  tick();
  setInterval(tick, secs * 1000);
} else {
  const act = !has('--status');
  console.log(`agent-relay: ${act ? 'one pass' : 'status only'}`);
  for (const [dir, lane] of Object.entries(LANES)) {
    const at = resolveBin(lane.bin);
    console.log(`  ${dir} → ${lane.owes}  ${at ? at : '(not installed — notes for it are reported, not dispatched)'}`);
  }
  pass({ act });
}
