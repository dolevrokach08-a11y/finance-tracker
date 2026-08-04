/**
 * Checks npm for newer versions of the self-hosted libraries, downloads them,
 * renames the files, and rewrites every reference. Run weekly by
 * .github/workflows/vendor-update.yml, which opens a PR with the result.
 *
 *   node tools/update-vendor.mjs            # apply updates
 *   node tools/update-vendor.mjs --dry-run  # report only
 *
 * It opens a PR rather than pushing, and that is deliberate — see the workflow
 * file for the reasoning.
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const manifestPath = join(ROOT, 'vendor', 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const cmp = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

async function latestVersion(npmName, pinMajor) {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(npmName)}`);
  if (!res.ok) throw new Error(`registry ${res.status} for ${npmName}`);
  const data = await res.json();
  if (pinMajor == null) return data['dist-tags'].latest;
  // Highest release that stays on the pinned major.
  return Object.keys(data.versions)
    .filter(v => /^\d+\.\d+\.\d+$/.test(v) && Number(v.split('.')[0]) === pinMajor)
    .sort(cmp).pop();
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length < 1000) throw new Error(`suspiciously small download (${body.length}b): ${url}`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, body);
  return body.length;
}

function rewriteRefs(refs, from, to) {
  for (const ref of refs) {
    const p = join(ROOT, ref);
    if (!existsSync(p)) { console.warn(`  ! ref not found: ${ref}`); continue; }
    const before = readFileSync(p, 'utf8');
    const after = before.split(from).join(to);
    if (before !== after) { writeFileSync(p, after); console.log(`  rewrote ${ref}`); }
  }
}

const updates = [];

for (const lib of manifest.libraries) {
  const latest = await latestVersion(lib.npm, lib.pinMajor);
  if (!latest || cmp(latest, lib.version) <= 0) {
    console.log(`= ${lib.npm}@${lib.version} is current`);
    continue;
  }

  const majorJump = latest.split('.')[0] !== lib.version.split('.')[0];
  console.log(`↑ ${lib.npm} ${lib.version} → ${latest}${majorJump ? '  ** MAJOR **' : ''}`);
  updates.push({ ...lib, from: lib.version, to: latest, majorJump });
  if (dryRun) continue;

  const newFile = lib.file.split(lib.version).join(latest);
  await download(`https://cdn.jsdelivr.net/npm/${lib.npm}@${latest}/${lib.path}`, join(ROOT, 'vendor', newFile));
  if (lib.sibling) {
    const newSibling = lib.sibling.file.split(lib.version).join(latest);
    await download(`https://cdn.jsdelivr.net/npm/${lib.npm}@${latest}/${lib.sibling.path}`, join(ROOT, 'vendor', newSibling));
    rewriteRefs(lib.refs, lib.sibling.file, newSibling);
    if (existsSync(join(ROOT, 'vendor', lib.sibling.file))) unlinkSync(join(ROOT, 'vendor', lib.sibling.file));
    lib.sibling.file = newSibling;
  }
  rewriteRefs(lib.refs, lib.file, newFile);
  if (existsSync(join(ROOT, 'vendor', lib.file))) unlinkSync(join(ROOT, 'vendor', lib.file));
  lib.file = newFile;
  lib.version = latest;
}

if (updates.length && !dryRun) {
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  // Any vendor change ships new bytes, so the shell cache has to roll over.
  const swPath = join(ROOT, 'sw.js');
  const sw = readFileSync(swPath, 'utf8');
  const bumped = sw.replace(/(finance-tracker-v)(\d+)/, (_, p, n) => p + (Number(n) + 1));
  writeFileSync(swPath, bumped);
  console.log(`\nbumped sw.js cache: ${(bumped.match(/finance-tracker-v\d+/) || [])[0]}`);
}

// Consumed by the workflow to build the PR body. Not written on a dry run —
// it is a build artifact, not a report.
if (updates.length && !dryRun) {
  const lines = updates.map(u =>
    `- **${u.npm}** ${u.from} → ${u.to}${u.majorJump ? '  ⚠️ **major — read the changelog before merging**' : ''}` +
    (u.note ? `\n  - ${u.note}` : ''));
  writeFileSync(join(ROOT, 'vendor-update-summary.md'), lines.join('\n') + '\n');
  console.log(`\n${updates.length} update(s).`);
} else {
  console.log('\nNothing to update.');
}
