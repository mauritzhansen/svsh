#!/usr/bin/env node
// watchdog.mjs — a deadline that can WAKE the lead.
//
// Lean SVSH adaptation of the DBP fleet's watchdog. The incident that
// produced it (2026-09-06): a reviewer started a test suite as a BACKGROUND
// job, ended its turn with "I'll send the verdict when it completes", and
// was never re-invoked — the verdict sat unread for ten hours. A session
// acts only when something structurally re-invokes it.
//
// The lead runs THIS script as a background Bash task (run_in_background:
// true) at every dispatch — `ledger.mjs add` prints the exact command, so
// arming the wake and creating the row are one act. The script sleeps until
// the deadline; its exit re-invokes the lead (harness task notification).
// Before exiting it LOOKS, through the ledger's `mark-silent` verb, and
// reports the answer — the must-fail case is a finished agent announced as
// silent, so a row that closed in time exits quietly.
//
// Usage:
//   node scripts/lead/watchdog.mjs <ledgerId> --minutes <n>   (production)
//   node scripts/lead/watchdog.mjs <ledgerId> --seconds <n>   (tests)
//   [--file <path>]                                           (tests)
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LEDGER = resolve(HERE, 'ledger.mjs');

function usage(m) {
  console.error(`watchdog: ${m}`);
  console.error('usage: watchdog.mjs <ledgerId> --minutes <n> | --seconds <n> [--file <path>]');
  process.exit(2);
}

const argv = process.argv.slice(2);
const id = argv[0];
if (!id || id.startsWith('--')) usage('needs a ledger id first');
let seconds = null;
let ledgerFile = null;
for (let i = 1; i < argv.length; i += 1) {
  const a = argv[i];
  const v = argv[i + 1];
  if (a === '--minutes' || a === '--seconds') {
    if (v === undefined || !/^\d+(\.\d+)?$/.test(v) || Number(v) <= 0) usage(`${a} needs a positive number`);
    seconds = a === '--minutes' ? Number(v) * 60 : Number(v);
    i += 1;
  } else if (a === '--file') {
    if (v === undefined || v.startsWith('--')) usage('--file needs a path');
    ledgerFile = v;
    i += 1;
  } else {
    usage(`unknown argument '${a}'`);
  }
}
if (seconds === null) usage('needs --minutes <n> or --seconds <n>');

const due = new Date(Date.now() + seconds * 1000);
console.log(`watchdog: ${id} — deadline ${due.toISOString()} (${Math.round(seconds)}s)`);

setTimeout(() => {
  const args = [LEDGER, 'mark-silent', id];
  if (ledgerFile) args.push('--file', ledgerFile);
  // Bounded: a hung ledger check must not swallow the wake — after 20s it
  // lands in the "did NOT run" branch, and an unchecked deadline never
  // reads like a clean one.
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 20000 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  if (r.error || r.status !== 0) {
    console.log(`watchdog: ${id} — the ledger check did NOT run (${out || r.error?.message || `exit ${r.status}`})`);
    console.log(`watchdog: ${id} UNCHECKED — run \`node scripts/lead/ledger.mjs sweep\` by hand`);
  } else if (/^ledger: SILENT /m.test(out)) {
    console.log(`watchdog: ${id} SILENT — the row was still open with no verdict when the deadline passed.`);
    console.log(`watchdog: ${id} — STOP the agent and RESPAWN fresh; do not extend the deadline and wait again.`);
    console.log(`watchdog: ${id} — run \`node scripts/lead/ledger.mjs sweep\` now`);
  } else {
    console.log(`watchdog: ${id} — nothing to escalate: ${out}`);
  }
  process.exit(0);
}, seconds * 1000);
