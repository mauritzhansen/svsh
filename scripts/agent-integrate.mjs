#!/usr/bin/env node
// agent-integrate.mjs — the ONE step that integrates a reviewed worktree
// branch into master. Lean SVSH adaptation of the DBP integrator.
//
// Fail-closed order: every check runs BEFORE the authorization is consumed,
// and the authorization is consumed BEFORE the merge is attempted — no
// failure mode after that point leaves a spendable authorization behind.
// master only ever moves via `git merge --ff-only`, so it stays linear;
// this script never resolves a conflict and never creates a merge commit.
// On NOT-FF it refuses and names the remedy (the BUILDER rebases in its own
// worktree via scripts/agent-rebase.mjs and reports the new tip).
//
// `rebasedFrom` in the authorization CLAIMS the tip is a replay of an
// already-reviewed sha; the claim is proven with `git range-diff
// <rebasedFrom>...<sha>` — every commit pair must compare equal (`=`) or
// the replay is refused and needs a new round-1 review.
//
//   exit 0  integrated — master fast-forwarded to the authorized sha
//   exit 1  refused — see the printed reason; master did not move
//   exit 2  usage error
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const AUTH_FILE = process.env.SVSH_INTEGRATE_AUTH_FILE
  || resolve(REPO, '.cursor/plans/journal/authorizations/integrate.json');
const MAINLINE = 'master';

function die(m) { console.error(`integrate: REFUSED — ${m}`); process.exit(1); }
function git(...args) {
  const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

if (process.argv.length > 2) { console.error('integrate: takes no arguments'); process.exit(2); }

// 1. This is the main checkout, not a worktree.
const top = git('rev-parse', '--show-toplevel');
if (top.status !== 0) die('not a git repository');
if (top.out !== REPO) die(`runs only from the main checkout (${REPO}), not ${top.out}`);
const gitDir = git('rev-parse', '--git-dir');
if (gitDir.out.includes('worktrees')) die('runs only from the main checkout, never a worktree');

// 2. A live authorization exists and parses.
if (!existsSync(AUTH_FILE)) die(`no authorization at ${AUTH_FILE} — write one with scripts/lead/authorize.mjs after a PASS review`);
let auth;
try { auth = JSON.parse(readFileSync(AUTH_FILE, 'utf8')); }
catch (e) { die(`authorization unreadable (${e.message}) — rewrite it with authorize.mjs, never by hand`); }
for (const k of ['branch', 'sha', 'reviewedBy', 'expires_at']) {
  if (!auth[k]) die(`authorization missing '${k}' — rewrite it with authorize.mjs, never by hand`);
}
if (!Number.isInteger(auth.expires_at)) die('authorization expiry is not an integer — rewrite it with authorize.mjs, never by hand');
if (Math.floor(Date.now() / 1000) > auth.expires_at) die('authorization expired — re-authorize if the review still stands');

// 3. Mainline is checked out and the working tree is clean.
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch.out !== MAINLINE) die(`main checkout is on '${branch.out}', not ${MAINLINE}`);
const dirty = git('status', '--porcelain');
if (dirty.out !== '') die(`working tree is not clean:\n${dirty.out}`);

// 4. The authorized branch exists and its tip IS the authorized sha.
const tip = git('rev-parse', '--verify', `refs/heads/${auth.branch}`);
if (tip.status !== 0) die(`branch '${auth.branch}' does not exist`);
if (tip.out !== auth.sha) die(`branch '${auth.branch}' is at ${tip.out.slice(0, 12)}, but the authorization names ${auth.sha.slice(0, 12)} — the reviewed tip moved; a new review round is needed`);

// 5. If the authorization claims a rebase replay, PROVE it.
// Each side is anchored to its OWN base: the reviewed series is
// merge-base(rebasedFrom, master)..rebasedFrom, the replay is master..sha.
// (`A...B` would compare against the shared merge base and drag master's
// new commits into the right-hand series — a legitimate replay then reads
// as unequal, found by the must-fail test 2026-09-18.)
if (auth.rebasedFrom) {
  const base = git('merge-base', auth.rebasedFrom, MAINLINE);
  if (base.status !== 0) die(`no merge base between ${auth.rebasedFrom.slice(0, 12)} and ${MAINLINE} — cannot prove the replay; new round 1`);
  const rd = git('range-diff', `${base.out}..${auth.rebasedFrom}`, `${MAINLINE}..${auth.sha}`);
  if (rd.status !== 0) die(`range-diff failed (${rd.err || 'unknown'}) — cannot prove the replay; new round 1`);
  const lines = rd.out.split('\n').filter((l) => l.trim() !== '');
  const unequal = lines.filter((l) => !/^\s*\d+:\s+\S+\s+=\s+\d+:/.test(l));
  if (lines.length === 0) die('range-diff produced no commit pairs — cannot prove the replay; new round 1');
  if (unequal.length > 0) die(`the rebase is NOT an identical replay of the reviewed sha:\n${unequal.join('\n')}\nA changed patch needs a new round-1 review.`);
  console.log(`integrate: range-diff proves ${auth.sha.slice(0, 12)} replays reviewed ${auth.rebasedFrom.slice(0, 12)} (${lines.length} commits, all =)`);
}

// 6. Fast-forward is possible (mainline is an ancestor of the tip).
const anc = git('merge-base', '--is-ancestor', MAINLINE, auth.sha);
if (anc.status !== 0) die(`NOT-FF: ${MAINLINE} is not an ancestor of ${auth.sha.slice(0, 12)}. The BUILDER rebases in its worktree (scripts/agent-rebase.mjs), re-verifies, and reports the new tip; then re-authorize with --rebased-from ${auth.sha}`);

// 7. Consume the authorization — BEFORE the merge, so no path leaves it spendable.
unlinkSync(AUTH_FILE);

// 8. Fast-forward.
const merge = git('merge', '--ff-only', auth.sha);
if (merge.status !== 0) die(`ff-only merge failed after all checks (${merge.err}) — ${MAINLINE} did not move; re-authorize to retry`);
const now = git('rev-parse', 'HEAD');
if (now.out !== auth.sha) die(`post-merge HEAD is ${now.out.slice(0, 12)}, expected ${auth.sha.slice(0, 12)} — inspect by hand before doing anything else`);
console.log(`integrate: ${MAINLINE} fast-forwarded to ${auth.sha.slice(0, 12)} (branch ${auth.branch}, reviewed by ${auth.reviewedBy})`);
