#!/usr/bin/env node
// worktree-setup.mjs — a builder's FIRST act after spawning.
//
// Verifies the isolation actually took effect (the DBP fleet twice had
// builders land silently in the main checkout: `isolation: worktree` in an
// agent definition documents intent — only the spawn call does it), then
// installs dependencies so the worktree is runnable.
//
//   exit 0  ready — pwd is a worktree, node_modules installed
//   exit 1  STOP — pwd is NOT a worktree; report for a respawn, do not build
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const cwd = process.cwd();
if (!cwd.includes('/.claude/worktrees/')) {
  console.error(`worktree-setup: STOP — pwd is ${cwd}, not under .claude/worktrees/.`);
  console.error('worktree-setup: the spawn call did not isolate you. Report this for a respawn; do NOT build in the main checkout.');
  process.exit(1);
}
const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
console.log(`worktree-setup: in ${cwd} on branch ${branch}`);
if (!existsSync('node_modules')) {
  console.log('worktree-setup: installing dependencies (npm ci)…');
  const r = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('worktree-setup: npm ci failed — report this; do not improvise an install');
    process.exit(1);
  }
}
console.log('worktree-setup: ready');
