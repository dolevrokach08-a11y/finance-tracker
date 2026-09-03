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
// not wake anyone twice and an edited one does. State lives in .agent-relay-state.json,
// untracked, because "which notes has this machine dispatched" is a fact about this machine.
//
// On containment, plainly: **a worktree is not a security boundary.** It isolates git — a
// branch, an index, a checkout — and nothing else. The process running inside it is an
// ordinary process, and the allowlist grants `Bash(node:*)`, so Node can write outside the
// worktree and open the network whenever it likes. An earlier version of this comment said
// the worktree was "the real containment" and the allowlist merely "defence in depth". That
// was backwards, and it was the same mistake as the rest of this file's history: a safety
// property asserted rather than demonstrated. What is actually true is narrower — a relayed
// round cannot reach main or a remote **by way of git**, because it never checks out main
// and never pushes. Do not run --watch unattended on this basis alone.
//
// Usage:
//   node tools/agent-relay.mjs --status        what is pending, dispatch nothing
//   node tools/agent-relay.mjs --once          one pass
//   node tools/agent-relay.mjs --watch [secs]  poll (default 120)
//   node tools/agent-relay.mjs --reset         forget dispatch history
//   node tools/agent-relay.mjs --selftest [who] end-to-end check of one lane (claude|codex)
//
// The two lanes are not one command with a different name in front. Claude is invoked with
// `--print` and an explicit tool allowlist; Codex with `exec` and a sandbox, because it has
// no allowlist to give. See claudeArgv / codexArgv, which were read off `--help` rather than
// recalled. An earlier version passed Claude's flags to whichever binary the lane named,
// which meant the codex lane could never have run — and nobody found that out, because the
// "codex is not installed" check returned first and made it look like a missing install.
//
// The dispatch needs the CLI to be logged in, and that is the one thing this file cannot
// arrange. It took three wrong guesses to establish that, all of them made before anyone
// asked the CLI: not the shell, not a child process failing to inherit a session, and not
// missing credentials either. `claude auth status --text` says it in one line —
//
//     Login: Expired — log in again
//
// The credentials file is still there and still names the account, which is why an
// interactive `claude` looks signed in. What has died is the refresh token, and once that
// is gone nothing can renew itself; only a fresh login issues another one.
//
//   claude auth login     re-issues the pair
//   claude setup-token    a long-lived token, which is what --watch actually wants
//
// checkAuth below asks first, so this arrives before a worktree is built rather than as
// an OAuth message that invited two wrong conclusions.

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
  'from-gpt': { owes: 'claude', bin: 'claude', argv: claudeArgv, auth: claudeAuth },
  'from-claude': { owes: 'codex', bin: 'codex', argv: codexArgv, auth: codexAuth },
};

// How many times one thread may bounce automatically. A conversation that has gone five
// rounds without a person in it has stopped converging.
const MAX_ROUNDS = 5;

// How long one agent may work before the round is abandoned.
const TIMEOUT_MIN = 20;

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

// Two CLIs, two vocabularies for the same three ideas: run this prompt with no UI, work in
// this directory, stay inside these limits. Only the third differs in kind.
//
// Claude takes an explicit tool allowlist. Codex has none — it contains a run with a
// sandbox — so this names the sandbox mode and turns network access off rather than
// inheriting whatever the default happens to be. With no network there is nothing for
// `git push` or `gh` to reach: the same boundary reached by another road. Both lanes
// still work in a throwaway worktree, which is what actually contains them.
//
// These flags were read off `codex --help`, not recalled. That is the rule this file earned:
// three guesses were made about a failing login before anyone asked the tool, and when
// someone finally asked, it answered in one line.
function claudeArgv(brief) {
  return [
    '--print', brief,
    '--permission-mode', 'acceptEdits',
    '--allowedTools', ...ALLOWED,
    '--disallowedTools', ...DISALLOWED,
  ];
}

function codexArgv(brief, dir) {
  return [
    'exec', brief,
    '-C', dir,
    '-s', 'workspace-write',
    '-c', 'sandbox_workspace_write.network_access=false',
    '--color', 'never',
  ];
}

// Ask each CLI whether it can authenticate before building a worktree for it. Best effort:
// one that answers something unexpected gets the benefit of the doubt and is allowed to
// fail on its own terms — the point is to turn a silent non-start into a sentence.
function claudeAuth(binPath) {
  const r = launch(binPath, ['auth', 'status'], { encoding: 'utf8', timeout: 30000 });
  try {
    const j = JSON.parse((r.stdout || '').trim());
    if (j && j.loggedIn === false) return 'is not logged in — run `claude auth login`, or `claude setup-token` for something unattended';
  } catch { /* no such subcommand, or not JSON — let the dispatch speak for itself */ }
  return null;
}

function codexAuth(binPath) {
  const r = launch(binPath, ['login', 'status'], { encoding: 'utf8', timeout: 30000 });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  if (/not logged in|logged out|no credentials|please (run )?login/i.test(out)) {
    return 'is not logged in — run `codex login`';
  }
  return null;
}

// Removing a worktree is git's job, not the filesystem's. A plain recursive delete leaves
// git's registration behind and, on Windows, trips over its own locked files — a leftover
// from an earlier run made the next pass die with EPERM before it could do anything. So:
// ask git to remove it, prune the registration either way, drop the branch, and only then
// fall back to deleting whatever is still on disk, with retries for a lingering handle.
const branchExists = branch => {
  try { sh('git', ['rev-parse', '--verify', '--quiet', branch]); return true; }
  catch { return false; }
};

function clearWorktree(dir, branch) {
  try { sh('git', ['worktree', 'remove', '--force', dir]); } catch { /* not registered */ }
  try { sh('git', ['worktree', 'prune']); } catch { /* nothing to prune */ }
  try { sh('git', ['branch', '-D', branch]); } catch { /* no such branch */ }
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch (e) { throw new Error(`could not clear ${dir}: ${e.code || e.message}. Remove it by hand and retry.`); }
}

function dispatch(note, round) {
  const lane = LANES[note.dir];
  const binPath = resolveBin(lane.bin);
  if (!binPath) {
    return { ok: false, reason: `${lane.bin} is not installed here — this one still needs relaying by hand.` };
  }

  const authProblem = lane.auth(binPath);
  if (authProblem) return { ok: false, reason: `${lane.bin} ${authProblem}` };

  // A branch whose name starts with a dash reads as a flag to git, and a note called
  // _selftest.md produced exactly that.
  const slug = (basename(note.name, '.md').slice(0, 40).replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '') || 'note');

  // The name carries the note's contents and the round, so two rounds of one thread cannot
  // land on the same branch. When the name was the slug alone, dispatching a note a second
  // time began by force-removing the first round — deleting a committed reply that was
  // waiting to be read. A round's output is the only record that the round happened.
  const name = `${slug}-${String(note.hash).slice(0, 8)}-r${round}`;
  const branch = `relay/${name}`;
  const dir = join(WORKTREES, name);

  mkdirSync(WORKTREES, { recursive: true });

  // Refuse rather than overwrite. Reaching here with the branch already present means an
  // identical round already ran; whatever it produced is not this run's to throw away.
  if (branchExists(branch)) {
    return {
      ok: false, created: false, branch, dir, round,
      reason: `${branch} already exists — an identical round has run. Read that branch, and `
        + `delete it yourself if you want this note dispatched again.`,
    };
  }

  // Only an orphaned directory can be here now, since the branch does not exist.
  clearWorktree(dir, branch);
  sh('git', ['worktree', 'add', '-b', branch, dir, 'main']);

  // Deliver the note into the worktree. scan() reads notes from the checkout Dolev works
  // in; the worktree is built from main. So a note that is new, or edited and not yet
  // committed, does not exist on the branch the agent wakes up in. The first relayed round
  // hit exactly this: the agent was told to read a file, found nothing there, and said so.
  // Copying it in makes delivery the relay's job, which is the whole job it has.
  const delivered = join(dir, 'agents', note.dir, note.name);
  mkdirSync(dirname(delivered), { recursive: true });
  writeFileSync(delivered, readFileSync(note.path, 'utf8'));

  const res = launch(binPath, lane.argv(briefFor(note), dir),
    { cwd: dir, encoding: 'utf8', timeout: TIMEOUT_MIN * 60 * 1000 });

  const wrote = (() => {
    try { return sh('git', ['log', '--oneline', `main..${branch}`], { cwd: dir }); }
    catch { return ''; }
  })();

  // A commit is not an answer. The reply is required to go in the note itself, so check
  // that the note is what changed rather than trusting that something was committed. The
  // version that counted only commits would have called a dispatch green while the agent
  // was in fact reporting that it had nothing to read.
  const answered = (() => {
    try {
      const files = sh('git', ['diff', '--name-only', `main..${branch}`], { cwd: dir });
      return files.split(String.fromCharCode(10))
        .some(f => f.trim() === `agents/${note.dir}/${note.name}`);
    } catch { return false; }
  })();

  // Each way this can fail gets its own sentence. The version this replaces collapsed them:
  // a run that exited non-zero *after* committing a good reply reported "the agent produced
  // no commit", because reason was null and the caller filled the gap with a guess. That is
  // the same shape as the pre-commit hook this file spent the day fixing, written into the
  // fix hours later — so the caller's fallback is gone too, and a missing reason now says
  // that it is missing rather than inventing a cause.
  const timedOut = res.error && res.error.code === 'ETIMEDOUT';
  const reason =
      timedOut  ? `${lane.bin} was still working after ${TIMEOUT_MIN} minutes and was stopped`
    : res.error ? `${lane.bin} could not be run: ${res.error.message}`
    : !wrote    ? `${lane.bin} exited ${res.status} and left no commit`
    : !answered ? `committed, but not to agents/${note.dir}/${note.name} — the reply belongs in the note`
    : res.status !== 0
      ? `the reply is committed on ${branch}, but ${lane.bin} exited ${res.status} — read it before trusting it`
      : null;

  return {
    ok: !res.error && res.status === 0 && !!wrote && answered,
    // This run built the branch, so this run may remove it. A dispatch that refused to
    // touch an existing branch says created: false, and cleanup must respect that.
    created: true,
    reason,
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

  let changed = false;
  for (const note of pending) {
    const prev = st.notes[note.path] || { rounds: 0 };
    const round = prev.rounds + 1;
    const lane = LANES[note.dir];
    console.log(`\n→ ${note.dir}/${note.name}`);
    console.log(`  owed by: ${lane.owes}   round: ${round}`);

    if (round > MAX_ROUNDS) {
      console.log(`  ✗ stopping: ${MAX_ROUNDS} automatic rounds already. This one needs a person.`);
      if (act) { st.notes[note.path] = { ...prev, hash: note.hash, stalled: true }; changed = true; }
      continue;
    }
    if (!act) { console.log('  (status only — not dispatched)'); continue; }

    const r = dispatch(note, round);
    if (!r.ok) {
      console.log(`  ✗ ${r.reason || 'failed, and dispatch() did not say why — that is a bug in dispatch()'}`);
      if (r.output) console.log(r.output.split('\n').map(l => '    ' + l).join('\n'));
      // Not marked as dispatched: a failed wake should be retried, not swallowed.
      continue;
    }
    console.log(`  ✓ replied on ${r.branch}`);
    console.log(`    ${r.commits.split('\n').join('\n    ')}`);
    console.log(`    review: git log -p main..${r.branch}`);
    st.notes[note.path] = { hash: note.hash, rounds: round, branch: r.branch, at: new Date().toISOString() };
    changed = true;
  }

  // --status is a report and must leave no trace. It used to fall through to saveState
  // regardless, and worse, a note past MAX_ROUNDS was marked stalled at its current hash
  // by a command that only claimed to be looking — which would have quietly retired a
  // thread nobody had dispatched.
  if (changed) saveState(st);
  return st;
}

// One command that proves the whole path: writes a throwaway note, dispatches it, reports,
// and removes every trace including its own state entry. It exists because the manual
// version was four commands and a heredoc of Hebrew, which is too much ceremony for the
// check you want to repeat whenever authentication or a CLI changes.
const selftestName = owes => `_selftest-${owes}.md`;

function selftest(owes) {
  const entry = Object.entries(LANES).find(([, l]) => l.owes === owes);
  if (!entry) {
    const known = Object.values(LANES).map(l => l.owes).join(', ');
    console.log(`✗ no lane is owed by "${owes}". Lanes here: ${known}.`);
    return;
  }
  const [laneDir, lane] = entry;
  const SELFTEST = selftestName(owes);
  const dir = join(ROOT, 'agents', laneDir);
  const path = join(dir, SELFTEST);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, [
    '# בדיקת דוור — טענה אחת לאימות',
    '',
    'סוג: דיווח',
    '',
    '---',
    '',
    'הפתק הזה נוצר על ידי `--selftest` וימחק בסופו. הוא מכיל טענה אחת שאפשר לאמת בהרצה אחת.',
    '',
    '## הטענה',
    '',
    '`seniorityDiscount` ב-`mortgage.html` מחזירה **0.2 בדיוק** ב-36 חודשים ו-**0.3 בדיוק**',
    'ב-60 חודשים, והמעברים חדים — אין ערך ביניים.',
    '',
    '## מה שאני מבקש',
    '',
    'חשב את זה בעצמך מהקוד ואל תסתמך על הפתק. אם אתה מסכים — אמור על מה בדקת.',
    'אם יש ערך שמפריך, תן אותו.',
    '',
  ].join(String.fromCharCode(10)));

  console.log(`· wrote agents/${laneDir}/${SELFTEST}  →  waking ${owes}`);
  const note = { dir: laneDir, name: SELFTEST, path, lane, hash: 'selftest' };
  let r;
  try {
    r = dispatch(note, 1);
  } finally {
    rmSync(path, { force: true });
    console.log(`· removed agents/${laneDir}/${SELFTEST}`);
  }

  if (r.ok) {
    console.log(`
✓ the ${owes} lane works end to end — replied in the note, on ${r.branch}`);
    console.log(`  ${r.commits.split(String.fromCharCode(10)).join(String.fromCharCode(10) + '  ')}`);
    console.log(`  read it:  git log -p main..${r.branch}`);
    console.log('  it is left in place so you can look; delete with:');
    console.log(`    git worktree remove --force .relay/worktrees/${basename(r.dir)} && git branch -D ${r.branch}`);
  } else {
    console.log(`
✗ ${r.reason || 'failed, and dispatch() did not say why — that is a bug in dispatch()'}`);
    if (r.output) console.log(r.output.split(String.fromCharCode(10)).map(l => '  ' + l).join(String.fromCharCode(10)));
    // Only tidy away a worktree that holds nothing. The first failed round was cleaned up
    // automatically and took the agent's staged reply with it — a real answer, deleted for
    // being unfinished. Uncommitted work is the reason to keep a worktree, not to remove it.
    if (r.branch && r.created) {
      let leftovers = '';
      try { leftovers = sh('git', ['status', '--porcelain'], { cwd: r.dir }); } catch { /* gone */ }
      if (leftovers) {
        console.log(`· keeping ${r.dir} — the agent left work there:`);
        console.log(leftovers.split(String.fromCharCode(10)).map(l => '    ' + l).join(String.fromCharCode(10)));
        console.log(`  discard it with:  node tools/agent-relay.mjs --reset  (or git worktree remove --force ${r.dir})`);
      } else {
        try { clearWorktree(r.dir, r.branch); console.log('· cleaned up the worktree and branch'); }
        catch (e) { console.log('· ' + e.message); }
      }
    }
  }
}

const argv = process.argv.slice(2);
const has = f => argv.includes(f);

if (has('--selftest')) {
  // Testing one lane says nothing about the other: they run different binaries with
  // different flags under different containment. Defaults to claude, which is the lane
  // that existed first.
  const next = argv[argv.indexOf('--selftest') + 1];
  selftest(next && !next.startsWith('-') ? next : 'claude');
} else if (has('--reset')) {
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
