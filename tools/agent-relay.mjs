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
// On containment. A round runs in its own **clone**, not in a worktree of this repository.
// That began as a bug report from the machine itself: a linked worktree keeps its git
// directory back in the parent (.git/worktrees/<name>), so codex — whose sandbox grants
// write only inside the round's own directory — reviewed a note correctly, wrote the reply,
// and then could not record it, because index.lock lives outside the box. A clone puts .git
// inside the box.
//
// It is worth being exact about what that does and does not buy, since this file has a
// history of asserting safety rather than showing it:
//
//   Demonstrated — codex's sandbox refused a write outside its directory. That is an
//   observation from a real run, not a claim. With a clone, the round has no path to this
//   repository's refs at all, so it cannot move main even by accident.
//
//   NOT demonstrated — that codex has no network. network_access=false is set and has never
//   been tested. And the claude lane has no sandbox at all: its allowlist grants
//   `Bash(node:*)`, and Node can write anywhere and open a socket. For that lane the clone
//   bounds git, nothing more.
//
// So: the codex lane is contained. The claude lane is bounded in git and trusted otherwise.
//
// Usage:
//   node tools/agent-relay.mjs --status        what is pending, dispatch nothing
//   node tools/agent-relay.mjs --once          one pass
//   node tools/agent-relay.mjs --watch [secs]  poll (default 120)
//   node tools/agent-relay.mjs --prime         mark every note as seen, dispatch nothing
//   node tools/agent-relay.mjs --reset          forget all dispatch history
//   node tools/agent-relay.mjs --reset-note X   forget one note, so it is dispatched again
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
const ROUNDS = join(ROOT, '.relay', 'rounds');

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

// A .cmd or .bat shim cannot be executed by Node directly; cmd.exe has to run it, and
// cmd.exe re-parses whatever it is given. Passing the path as an ordinary argument breaks on
// any path containing a space — here, every path does: "C:\\Users\\Dolev Rokach\\..." arrived
// as the command "C:\\Users\\Dolev". Both lanes resolve to .exe files today, so nothing has hit
// this; an npm-installed CLI is a .cmd, and it would have.
//
// The fix is to build the command line, quote every token, and tell Node not to touch it.
// Verified against a shim under a spaced path with a Hebrew argument containing & and %.
function launch(binPath, args, opts) {
  if (/\.(cmd|bat)$/i.test(binPath)) {
    const quote = t => '"' + String(t).replace(/"/g, '\\"') + '"';
    const line = '"' + [binPath, ...args].map(quote).join(' ') + '"';
    return spawnSync(process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', line],
      { ...opts, windowsVerbatimArguments: true });
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
    // A leading underscore marks a file the relay itself made — the selftest note is one.
    // Without this, running --selftest while --watch is up hands the watcher a note to
    // dispatch as if a person had left it.
    for (const name of readdirSync(abs).filter(f => f.endsWith('.md') && !f.startsWith('_'))) {
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

// Read, search, reason, run the repo's own checks, and commit inside the round. No push, no
// merge, no gh. Note what this list is and is not: with Bash(node:*) on it, it does not
// confine the process — see the note on containment at the top. It states the shape of the
// job, and it stops the ordinary mistakes.
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
// still run in a throwaway clone, which is what actually contains the codex one.
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

// Ask each CLI whether it can authenticate before building a round for it. Best effort:
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

const branchExists = branch => {
  try { sh('git', ['rev-parse', '--verify', '--quiet', branch]); return true; }
  catch { return false; }
};

// A clone is an ordinary directory — no registration in this repo to prune, and no branch
// of ours living inside it. Deleting one is a delete, which is the point: the teardown that
// worktrees needed was itself a source of failures.
function removeRound(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch (e) { throw new Error(`could not remove ${dir}: ${e.code || e.message}. Remove it by hand.`); }
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
  const dir = join(ROUNDS, name);

  mkdirSync(ROUNDS, { recursive: true });

  // Refuse rather than overwrite. Reaching here with the branch already present means an
  // identical round already ran; whatever it produced is not this run's to throw away.
  if (branchExists(branch)) {
    return {
      ok: false, created: false, branch, dir, round,
      reason: `${branch} already exists — an identical round has run. Read that branch, and `
        + `delete it yourself if you want this note dispatched again.`,
    };
  }

  // Only a leftover directory can be here now, since the branch does not exist.
  removeRound(dir);
  sh('git', ['clone', '--quiet', '--no-hardlinks', '--single-branch', '--branch', 'main', ROOT, dir]);
  sh('git', ['checkout', '--quiet', '-b', branch], { cwd: dir });

  // Deliver the note into the round. scan() reads notes from the checkout Dolev works in;
  // the round is built from main. So a note that is new, or edited and not yet committed,
  // does not exist on the branch the agent wakes up in. The first relayed round hit exactly
  // this: the agent was told to read a file, found nothing there, and said so. Copying it in
  // makes delivery the relay's job, which is the whole job it has.
  const delivered = join(dir, 'agents', note.dir, note.name);
  const deliveredText = readFileSync(note.path, 'utf8');
  mkdirSync(dirname(delivered), { recursive: true });
  writeFileSync(delivered, deliveredText);

  const res = launch(binPath, lane.argv(briefFor(note), dir),
    { cwd: dir, encoding: 'utf8', timeout: TIMEOUT_MIN * 60 * 1000 });

  // Record whatever the agent left, from outside the sandbox.
  //
  // Codex cannot do this for itself. Its workspace-write sandbox refuses to write .git even
  // when .git sits inside the workspace — moving the round from a worktree to a clone did not
  // change that, which is how the guard was shown to be about .git and not about paths. The
  // tool ships `codex apply` for exactly this reason: it is built to produce a change that
  // something outside the box records. Claude commits for itself, and then this finds nothing
  // staged and does nothing.
  //
  // Only agents/ is staged. The brief forbids touching anything else, so a file outside it is
  // a finding to report, not a contribution to commit.
  // Whether the note came back changed at all. Everything below turns on this, because the
  // relay delivering a file and then committing it is not an answer — and for one run it
  // looked like one: the agent died on a token refresh having written nothing, the relay
  // committed the untouched note it had just delivered, and both "there is a commit" and
  // "the commit touches the note" were satisfied by the relay's own delivery. The only thing
  // that stopped a green was the CLI's non-zero exit, which is luck, not a check.
  let replied = false;
  try {
    const back = readFileSync(delivered, 'utf8');
    replied = back !== deliveredText && /^##\s+תגובה/m.test(back);
  } catch { /* the agent deleted it, which is not a reply either */ }

  let stray = [];
  let commitFailed = null;
  try {
    const dirty = sh('git', ['status', '--porcelain'], { cwd: dir })
      .split(String.fromCharCode(10)).map(l => l.trimEnd()).filter(Boolean);
    const paths = dirty.map(l => l.slice(3).replace(/^"|"$/g, ''));
    stray = paths.filter(p => !p.startsWith('agents/'));
    if (replied && paths.length && !stray.length) {
      sh('git', ['add', '--', 'agents'], { cwd: dir });
      if (sh('git', ['diff', '--cached', '--name-only'], { cwd: dir })) {
        sh('git', ['commit', '--quiet', '-m', [
          `Reply from ${lane.owes} to ${note.dir}/${note.name}`,
          '',
          'Written by the agent, committed by tools/agent-relay.mjs from outside the',
          "sandbox. Only agents/ is staged; the round changed nothing else.",
          '',
          `Co-Authored-By: ${lane.owes === 'codex' ? 'Codex <noreply@openai.com>' : 'Claude Opus 5 <noreply@anthropic.com>'}`,
        ].join(String.fromCharCode(10))], { cwd: dir });
      }
    }
  } catch (e) { commitFailed = (e.stderr || e.message || '').trim().slice(-400); }

  const wrote = (() => {
    try { return sh('git', ['log', '--oneline', `main..${branch}`], { cwd: dir }); }
    catch { return ''; }
  })();

  // The reply exists only inside the clone until it is fetched. Do this before anything can
  // remove the directory, and report a failure to fetch as its own failure — a round whose
  // answer was written and then lost is the worst outcome this tool has, and it has already
  // happened once by another route.
  let fetchFailed = null;
  if (wrote) {
    try { sh('git', ['fetch', '--quiet', dir, `${branch}:${branch}`]); }
    catch (e) { fetchFailed = e.message; }
  }

  // A commit is not an answer. The reply is required to go in the note itself, so check
  // that the note is what changed rather than trusting that something was committed. The
  // version that counted only commits would have called a dispatch green while the agent
  // was in fact reporting that it had nothing to read.
  const answered = replied && (() => {
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
      stray.length ? `the round changed files outside agents/, which the brief forbids: ${stray.join(', ')}. Nothing was committed; the round is at ${dir}`
    : commitFailed ? `the reply could not be committed: ${commitFailed}`
    : timedOut  ? `${lane.bin} was still working after ${TIMEOUT_MIN} minutes and was stopped`
    : res.error ? `${lane.bin} could not be run: ${res.error.message}`
    : fetchFailed ? `${lane.bin} replied, but the branch could not be fetched out of ${dir}: ${fetchFailed}`
    : !replied  ? `${lane.bin} exited ${res.status} without writing a reply into agents/${note.dir}/${note.name} — the note came back exactly as delivered`
    : !wrote    ? `${lane.bin} exited ${res.status} and left no commit`
    : !answered ? `committed, but not to agents/${note.dir}/${note.name} — the reply belongs in the note`
    : res.status !== 0
      ? `the reply is committed on ${branch}, but ${lane.bin} exited ${res.status} — read it before trusting it`
      : null;

  return {
    ok: !res.error && res.status === 0 && !stray.length && !commitFailed && !!wrote && answered && !fetchFailed,
    // This run built the branch, so this run may remove it. A dispatch that refused to
    // touch an existing branch says created: false, and cleanup must respect that.
    created: true,
    // For the caller's cleanup decision: whether the note came back changed, and whether
    // anything outside agents/ was touched. Both are facts about content, not guesses.
    replied, stray,
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
    // The branch was fetched into this repository, so nothing is lost with the clone.
    try { removeRound(r.dir); console.log('  (the round\'s clone is removed; the branch is here)'); }
    catch (e) { console.log('  ' + e.message); }
    console.log(`  delete the branch with:  git branch -D ${r.branch}`);
  } else {
    console.log(`
✗ ${r.reason || 'failed, and dispatch() did not say why — that is a bug in dispatch()'}`);
    if (r.output) console.log(r.output.split(String.fromCharCode(10)).map(l => '  ' + l).join(String.fromCharCode(10)));
    // A round holding anything uncommitted is never removed. The version before this one
    // tried to be clever — it discounted the delivered note, on the grounds that the relay
    // had put it there and it was not the agent's work. But the reply is written *into* that
    // note, so the one file that had to be kept was the one file being ignored, and a codex
    // round that had answered correctly was deleted by the code written to stop exactly that.
    // Now that the relay commits the reply itself, anything still dirty here is a genuine
    // leftover, and leftovers are kept.
    // Remove a round only when the relay can prove there is nothing in it: the note came
    // back byte-identical to what was delivered, and nothing outside agents/ was touched.
    // That is an equality check against bytes this process wrote, not a judgement about
    // which files look important — the judgement version deleted a correct answer.
    if (r.branch && r.created) {
      const disposable = r.replied === false && !(r.stray || []).length;
      let mine = [];
      if (!disposable) {
        try {
          mine = sh('git', ['status', '--porcelain'], { cwd: r.dir })
            .split(String.fromCharCode(10)).filter(l => l.trim());
        } catch { /* the directory is already gone */ }
      }
      if (mine.length) {
        console.log(`· keeping ${r.dir} — the agent left work there:`);
        console.log(mine.map(l => '    ' + l).join(String.fromCharCode(10)));
        console.log(`  remove it with:  rm -rf ${r.dir}`);
      } else {
        try { removeRound(r.dir); console.log('· removed the round; nothing was left in it'); }
        catch (e) { console.log('· ' + e.message); }
      }
    }
  }
}

// Start --watch quietly. Turning the watcher on with open notes means every one of them is
// "changed since never" and goes out at once — three, at the time this was written, into two
// CLIs on one machine. Priming records what is on disk as already seen, so the watcher reacts
// to the next edit rather than to the backlog. It is the honest version of what people
// otherwise do, which is run --reset and hope.
function prime() {
  const st = loadState();
  let marked = 0;
  for (const note of scan()) {
    if (st.notes[note.path]?.hash === note.hash) continue;
    const prev = st.notes[note.path] || { rounds: 0 };
    st.notes[note.path] = { ...prev, hash: note.hash, primed: true, at: new Date().toISOString() };
    console.log(`  · ${note.dir}/${note.name}`);
    marked++;
  }
  if (marked) {
    saveState(st);
    console.log(`✓ ${marked} note(s) marked as seen. --watch will answer the next change, not these.`);
  } else {
    console.log('· nothing to mark — every note was already seen at its current contents.');
  }
}

// Forget one note rather than all of them, which is what --reset does and why --reset is
// rarely what someone means.
function resetNote(which) {
  if (!which) { console.log('✗ --reset-note needs a note: a filename, or any part of its path.'); return; }
  const st = loadState();
  const hits = Object.keys(st.notes).filter(p => p.includes(which) || basename(p) === which);
  if (!hits.length) { console.log(`✗ nothing dispatched matches "${which}".`); return; }
  if (hits.length > 1) {
    console.log(`✗ "${which}" matches ${hits.length} notes; name one of them:`);
    for (const h of hits) console.log(`    ${basename(h)}`);
    return;
  }
  delete st.notes[hits[0]];
  saveState(st);
  console.log(`✓ forgotten: ${basename(hits[0])} — the next pass will dispatch it again.`);
}

const argv = process.argv.slice(2);
const has = f => argv.includes(f);

if (has('--selftest')) {
  // Testing one lane says nothing about the other: they run different binaries with
  // different flags under different containment. Defaults to claude, which is the lane
  // that existed first.
  const next = argv[argv.indexOf('--selftest') + 1];
  selftest(next && !next.startsWith('-') ? next : 'claude');
} else if (has('--prime')) {
  prime();
} else if (has('--reset-note')) {
  resetNote(argv[argv.indexOf('--reset-note') + 1]);
} else if (has('--reset')) {
  const pending = (() => {
    const st = loadState();
    return scan().filter(n => st.notes[n.path]?.hash === n.hash).length;
  })();
  rmSync(STATE, { force: true });
  console.log('✓ dispatch history forgotten.');
  if (pending) {
    console.log(`  ${pending} note(s) that had been answered now look new, and the next pass will`);
    console.log('  dispatch all of them. If that is not what you wanted: --prime, or --reset-note X.');
  }
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
