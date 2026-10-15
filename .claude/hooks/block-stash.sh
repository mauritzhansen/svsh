#!/bin/sh
# Claude Code PreToolUse adapter for the shared git-stash policy.
# Translates Claude Code hook I/O to/from the Cursor format and delegates
# the actual decision to .cursor/hooks/block-stash.sh so the policy lives
# in one place across both tools.

input=$(cat)

HOOK_INPUT="$input" PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}" node <<'NODE'
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let payload;
try {
  payload = JSON.parse(process.env.HOOK_INPUT || '{}');
} catch (e) {
  process.exit(0); // fail open on parse error
}

if (payload.tool_name !== 'Bash') {
  process.exit(0);
}

const command = (payload.tool_input && payload.tool_input.command) || '';
const cursorHook = path.join(process.env.PROJECT_DIR, '.cursor', 'hooks', 'block-stash.sh');

if (!fs.existsSync(cursorHook)) {
  process.exit(0); // nothing to delegate to
}

const result = spawnSync('sh', [cursorHook], {
  input: JSON.stringify({ command }),
  encoding: 'utf8',
});

if (result.status !== 0) {
  process.exit(0); // fail open if the delegate errors
}

let response;
try {
  response = JSON.parse(result.stdout.trim());
} catch (e) {
  process.exit(0);
}

if (response.permission === 'deny') {
  process.stderr.write(response.agent_message || response.user_message || 'Blocked by git-safety hook');
  process.exit(2); // exit 2 = block + feed stderr back to the model
}

process.exit(0);
NODE
