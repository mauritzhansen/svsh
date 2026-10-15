#!/usr/bin/env node
// authorize.mjs — the SOLE writer of integration authorizations.
//
// Lean SVSH adaptation. The DBP incident that made this a script rather
// than a hand-written file (2026-09-08): the lead once hand-wrote an
// authorization with an ISO-8601 timestamp where the consumer did a numeric
// comparison; four pushes were refused against a green tree and the day
// went. The format now stops being something anyone types.
//
// An authorization is single-use, sha-pinned and expiring. It names the
// REVIEWED tip and the closed reviewer ledger row that passed it. Writing
// one is a claim that a review PASSED — agent-integrate.mjs consumes it.
//
// Usage:
//   node scripts/lead/authorize.mjs integrate --branch <b> --sha <full 40>
//        --reviewed-by <reviewerLedgerRowId> [--rebased-from <full 40>]
//        [--minutes <n>]   (expiry, default 30)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
export const AUTH_FILE = process.env.SVSH_INTEGRATE_AUTH_FILE
  || resolve(REPO, '.cursor/plans/journal/authorizations/integrate.json');

function die(m) { console.error(`authorize: ${m}`); process.exit(1); }

const argv = process.argv.slice(2);
if (argv[0] !== 'integrate') die('the only verb is `integrate` — pushing is never authorized here: it is Mauritz\'s, by hand, every time');
const flags = {};
for (let i = 1; i < argv.length; i += 1) {
  const a = argv[i];
  if (!a.startsWith('--')) die(`unexpected argument '${a}'`);
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) die(`${a} needs a value`);
  flags[a.slice(2)] = v;
  i += 1;
}

if (!flags.branch) die('requires --branch');
if (!/^[0-9a-f]{40}$/.test(flags.sha || '')) die('requires --sha as the FULL 40-char reviewed tip (a short sha can be forged by prefix)');
if (!flags['reviewed-by']) die('requires --reviewed-by <closed reviewer ledger row id> — no review row, no authorization');
if (flags['rebased-from'] && !/^[0-9a-f]{40}$/.test(flags['rebased-from'])) die('--rebased-from must be the FULL 40-char previously-reviewed sha');
const minutes = flags.minutes ? Number(flags.minutes) : 30;
if (!Number.isInteger(minutes) || minutes <= 0) die('--minutes must be a positive integer');

const auth = {
  branch: flags.branch,
  sha: flags.sha,
  reviewedBy: flags['reviewed-by'],
  ...(flags['rebased-from'] ? { rebasedFrom: flags['rebased-from'] } : {}),
  expires_at: Math.floor(Date.now() / 1000) + minutes * 60,
  written: new Date().toISOString(),
};
mkdirSync(dirname(AUTH_FILE), { recursive: true });
writeFileSync(AUTH_FILE, `${JSON.stringify(auth, null, 2)}\n`);
console.log(`authorize: integrate ${flags.branch}@${flags.sha.slice(0, 12)} (reviewed by ${flags['reviewed-by']}, expires in ${minutes}m)`);
console.log('authorize: now run `node scripts/agent-integrate.mjs` from the main checkout');
