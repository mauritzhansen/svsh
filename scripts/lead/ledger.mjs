#!/usr/bin/env node
// ledger.mjs — the lead's in-flight ledger as a bounded CLI.
//
// Lean SVSH adaptation of the DBP fleet's ledger (see the agent-fleet pack,
// 2026-09-10, and ~/git_repos/dbp/scripts/lead/ledger.mjs for the full
// incident history). The mechanisms kept, and why:
//   - rows are structured and CAPPED (what ≤ 120 chars, outcome ≤ 200);
//     narrative belongs in the plan's STATE.md, never here. The DBP
//     predecessor was a hand-edited markdown file that reached 200KB and
//     182 edits in one day.
//   - closed rows LEAVE the file (appended to in-flight-closed.jsonl the
//     lead never reads), so the open ledger stays a screenful.
//   - every dispatch carries a DEADLINE (the agent's honest estimate × 2)
//     and `add` prints the watchdog command as part of its own output —
//     arming the wake and creating the row are one act. A dispatch without
//     a deadline is how the DBP fleet lost ten hours overnight (2026-09-06).
//   - `add` requires --plan <slug> or --no-plan: "I forgot" must not be
//     able to look like "not applicable".
//   - at most 3 open agent rows (solo-repo concurrency cap).
//
// State: .cursor/plans/journal/in-flight.json (gitignored, survives any
// session). Single-writer by design: only the lead calls this.
//
// Usage:
//   ledger.mjs add <id> --role builder|reviewer|other --minutes <n>
//             --what "<≤120>" (--plan <slug> | --no-plan) [--kind agent]
//   ledger.mjs close <id> --outcome "<≤200>"
//   ledger.mjs block <id> --why "<≤200>"
//   ledger.mjs unblock <id>
//   ledger.mjs sweep            (BLOCKED and OVERDUE first; run at every wake)
//   ledger.mjs show [<id>]
//   ledger.mjs mark-silent <id> (watchdog only)
//   [--file <path>]             (tests)
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const DEFAULT_FILE = resolve(REPO, '.cursor/plans/journal/in-flight.json');

function die(msg) { console.error(`ledger: ${msg}`); process.exit(1); }
function usage(msg) { console.error(`ledger: ${msg}`); process.exit(2); }

const argv = process.argv.slice(2);
const verb = argv.shift();
if (!verb) usage('needs a verb: add | close | block | unblock | sweep | show | mark-silent');

// ── argument parsing ────────────────────────────────────────────────────────
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--no-plan') { flags.noPlan = true; continue; }
  if (a.startsWith('--')) {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) usage(`${a} needs a value`);
    flags[a.slice(2)] = v;
    i += 1;
  } else {
    positional.push(a);
  }
}
const file = flags.file ? resolve(flags.file) : DEFAULT_FILE;

function load() {
  if (!existsSync(file)) return [];
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { die(`cannot parse ${file}: ${e.message}`); }
}
function save(rows) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(rows, null, 2)}\n`);
  renameSync(tmp, file);
}
function archive(row) {
  const closed = file.replace(/\.json$/, '-closed.jsonl');
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(closed, `${JSON.stringify(row)}\n`);
}
function fmt(r) {
  const status = r.blocked ? `BLOCKED(${r.blockedWhy})` : (overdue(r) ? 'OVERDUE' : 'open');
  const plan = r.plan ? `plan=${r.plan}` : 'no-plan';
  return `${r.id}  [${r.role}]  ${status}  ${plan}  due=${r.deadline}  ${r.what}`;
}
function overdue(r) { return !r.blocked && Date.now() > Date.parse(r.deadline); }

const rows = load();
const id = positional[0];

if (verb === 'add') {
  if (!id) usage('add needs an id');
  if (rows.some((r) => r.id === id)) die(`row '${id}' already exists`);
  if (!flags.role || !['builder', 'reviewer', 'other'].includes(flags.role)) die('add requires --role builder|reviewer|other');
  if (!flags.minutes || !/^\d+$/.test(flags.minutes)) die('add requires --minutes <n> (the agent\'s honest estimate × 2 — never a lookup table)');
  if (!flags.what) die('add requires --what');
  if (flags.what.length > 120) die(`--what is ${flags.what.length} chars; the cap is 120. Narrative belongs in STATE.md.`);
  if (!flags.plan && !flags.noPlan) die('add requires --plan <slug> or --no-plan: an unkeyed row cannot be linked to its work');
  if (flags.plan && flags.noPlan) die('--plan and --no-plan are mutually exclusive');
  const kind = flags.kind || 'agent';
  const openAgents = rows.filter((r) => r.kind === 'agent' && !r.blocked);
  if (kind === 'agent' && openAgents.length >= 3) die(`3 agent rows already open (${openAgents.map((r) => r.id).join(', ')}); close one first`);
  if (flags.role === 'builder' && flags.plan && rows.some((r) => r.role === 'builder' && r.plan === flags.plan)) {
    die(`plan '${flags.plan}' already has an open builder row; findings go to THAT builder by SendMessage, never to a second one`);
  }
  const minutes = Number(flags.minutes);
  const row = {
    id, kind, role: flags.role, what: flags.what,
    plan: flags.plan || null, noPlan: !!flags.noPlan,
    minutes, deadline: new Date(Date.now() + minutes * 60000).toISOString(),
    blocked: false, created: new Date().toISOString(),
  };
  rows.push(row);
  save(rows);
  console.log(`ledger: added ${fmt(row)}`);
  console.log('ledger: now arm the watchdog — run this as a BACKGROUND Bash task (run_in_background: true):');
  console.log(`  node scripts/lead/watchdog.mjs ${id} --minutes ${minutes}${flags.file ? ` --file ${file}` : ''}`);
} else if (verb === 'close') {
  if (!id) usage('close needs an id');
  const i = rows.findIndex((r) => r.id === id);
  if (i === -1) die(`no open row '${id}'`);
  if (!flags.outcome) die('close requires --outcome "<what actually happened, ≤200 chars>"');
  if (flags.outcome.length > 200) die(`--outcome is ${flags.outcome.length} chars; the cap is 200`);
  const [row] = rows.splice(i, 1);
  row.closed = new Date().toISOString();
  row.outcome = flags.outcome;
  archive(row);
  save(rows);
  console.log(`ledger: closed ${id} — ${flags.outcome}`);
} else if (verb === 'block') {
  if (!id) usage('block needs an id');
  const row = rows.find((r) => r.id === id);
  if (!row) die(`no open row '${id}'`);
  if (!flags.why) die('block requires --why');
  if (flags.why.length > 200) die(`--why is ${flags.why.length} chars; the cap is 200`);
  row.blocked = true;
  row.blockedWhy = flags.why;
  save(rows);
  console.log(`ledger: blocked ${id} — ${flags.why}`);
} else if (verb === 'unblock') {
  if (!id) usage('unblock needs an id');
  const row = rows.find((r) => r.id === id);
  if (!row) die(`no open row '${id}'`);
  row.blocked = false;
  delete row.blockedWhy;
  save(rows);
  console.log(`ledger: unblocked ${id}`);
} else if (verb === 'sweep') {
  const blocked = rows.filter((r) => r.blocked);
  const late = rows.filter((r) => overdue(r));
  const open = rows.filter((r) => !r.blocked && !overdue(r));
  for (const r of blocked) console.log(`sweep: ${fmt(r)}`);
  for (const r of late) console.log(`sweep: ${fmt(r)}  ← check the agent (TaskOutput), then close+respawn or close`);
  for (const r of open) console.log(`sweep: ${fmt(r)}`);
  if (rows.length === 0) console.log('sweep: ledger empty — nothing in flight');
} else if (verb === 'show') {
  const subset = id ? rows.filter((r) => r.id === id) : rows;
  if (id && subset.length === 0) die(`no open row '${id}'`);
  for (const r of subset) console.log(fmt(r));
  if (subset.length === 0) console.log('ledger: empty');
} else if (verb === 'mark-silent') {
  // Called by the watchdog when a deadline fires. The confirmation line
  // ("ledger: SILENT …") is the evidence the watchdog greps for; every
  // "nothing to mark" outcome also exits 0 but prints a different line —
  // a finished agent must never be announced as silent.
  if (!id) usage('mark-silent needs an id');
  const row = rows.find((r) => r.id === id);
  if (!row) { console.log(`ledger: ${id} is not open (closed or never existed) — nothing to mark`); process.exit(0); }
  if (row.blocked) { console.log(`ledger: ${id} is BLOCKED (${row.blockedWhy}) — a blocked row is waiting on a human, not silent`); process.exit(0); }
  if (row.kind !== 'agent') { console.log(`ledger: ${id} is not an agent row — nothing to mark`); process.exit(0); }
  if (!overdue(row)) { console.log(`ledger: ${id} is not past its deadline — nothing to mark`); process.exit(0); }
  row.silent = new Date().toISOString();
  save(rows);
  console.log(`ledger: SILENT ${id} — the row was still open with no verdict when its deadline passed`);
} else {
  usage(`unknown verb '${verb}'`);
}
