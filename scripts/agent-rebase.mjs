#!/usr/bin/env node
// agent-rebase.mjs — the one way a builder rebases its worktree branch onto
// master. Exists because raw `git rebase` sits behind a permission prompt
// (a mid-rebase agent with conflict markers is how work gets lost), while a
// bounded wrapper can be allowed: it either completes cleanly or aborts and
// reports — it never leaves a rebase in progress.
//
// Run from INSIDE the builder's worktree.
//   exit 0  rebased cleanly onto master — re-verify, then report the new tip
//   exit 1  conflict: the rebase was ABORTED, the branch is unchanged —
//           report the conflicting files to the lead
//   exit 2  refused (wrong place / dirty tree)
import { spawnSync } from 'node:child_process';

function git(...args) {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
function die(code, m) { console.error(`agent-rebase: ${m}`); process.exit(code); }

const gitDir = git('rev-parse', '--git-dir');
if (gitDir.status !== 0) die(2, 'not a git repository');
if (!gitDir.out.includes('worktrees')) die(2, 'runs only inside a builder worktree, never the main checkout');
const dirty = git('status', '--porcelain');
if (dirty.out !== '') die(2, `working tree not clean — commit your work first:\n${dirty.out}`);

const before = git('rev-parse', 'HEAD').out;
const rebase = git('rebase', 'master');
if (rebase.status !== 0) {
  git('rebase', '--abort');
  const conflict = `${rebase.out}\n${rebase.err}`.trim();
  die(1, `conflict — rebase ABORTED, branch unchanged at ${before.slice(0, 12)}.\n${conflict}\nReport the conflicting files to the lead; do not resolve by force.`);
}
const after = git('rev-parse', 'HEAD').out;
console.log(`agent-rebase: rebased onto master — tip ${before.slice(0, 12)} → ${after.slice(0, 12)}`);
console.log('agent-rebase: now RE-RUN your verify commands, then report the new tip sha to the lead');
