// The failure mode that matters for the Tailwind swap is a utility used in the
// markup that has no rule in the generated stylesheet. Check that directly.
//
// Note: Tailwind escapes special characters in selectors, so the class
// `md:grid-cols-2` appears in CSS as `.md\:grid-cols-2` and `py-0.5` as
// `.py-0\.5`. The match has to allow an optional backslash before each of them.
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..') + '/';
const html = fs.readFileSync(root + 'finance.html', 'utf8');
const css = fs.readFileSync(root + 'finance.tailwind.css', 'utf8');

const tokens = new Set();
for (const m of html.matchAll(/class(?:Name)?\s*=\s*["'`]([^"'`]*)["'`]/g)) {
  for (const t of m[1].split(/\s+/)) if (t) tokens.add(t);
}

const TW = /^(sm:|md:|lg:|xl:|hover:|focus:|active:|disabled:|group-hover:)*(flex|grid|hidden|block|inline|container|items-|justify-|self-|content-|gap-|grid-cols-|col-|row-|p[xytblrse]?-|-?m[xytblrse]?-|w-|h-|min-|max-|text-|font-|leading-|tracking-|bg-|from-|via-|to-|rounded|border|divide-|shadow|opacity-|space-[xy]-|overflow-|absolute|relative|fixed|sticky|static|top-|bottom-|left-|right-|inset-|z-|cursor-|transition|duration-|ease-|transform|scale-|rotate-|translate-|whitespace-|truncate|break-|list-|align-|table-|order-|flex-|basis-|grow|shrink|object-|pointer-events-|select-|resize|appearance-|outline|ring|placeholder-|caret-|accent-|fill-|stroke-|sr-only|not-sr-only|antialiased|italic|underline|line-through|uppercase|lowercase|capitalize|normal-case)/;

// Build a pattern where every char CSS would escape may optionally be preceded
// by a backslash in the stylesheet.
function selectorPattern(cls) {
  let out = '';
  for (const ch of cls) {
    if (/[a-zA-Z0-9_-]/.test(ch)) out += ch;
    else out += '\\\\?' + ch.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  }
  return out;
}

const missing = [];
let checked = 0;
for (const t of tokens) {
  if (!TW.test(t)) continue;
  checked++;
  const re = new RegExp('\\.' + selectorPattern(t) + '(?![\\w-])');
  if (!re.test(css)) missing.push(t);
}

console.log('distinct class tokens in finance.html:', tokens.size);
console.log('tailwind-looking tokens checked:', checked);
console.log('MISSING from generated css:', missing.length);
if (missing.length) console.log(missing.sort().join('\n'));
