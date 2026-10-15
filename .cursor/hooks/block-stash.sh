#!/bin/sh

input=$(cat)

HOOK_INPUT=$input node <<'NODE'
function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function parseShellWords(command) {
  const tokens = [];
  let token = '';
  let quote = null;
  let escaped = false;

  function pushToken() {
    if (token.length > 0) {
      tokens.push(token);
      token = '';
    }
  }

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];

    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        token += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      pushToken();
      continue;
    }

    if (char === ';' || char === '|' || char === '&' || char === '(' || char === ')') {
      pushToken();

      const next = command[i + 1];
      if ((char === '|' && next === '|') || (char === '&' && next === '&')) {
        i += 1;
      }

      tokens.push('__CMD_SEPARATOR__');
      continue;
    }

    token += char;
  }

  pushToken();
  return tokens;
}

function isGitToken(token) {
  return token === 'git' || token.endsWith('/git');
}

const gitOptionsWithValue = new Set([
  '-C',
  '-c',
  '--config-env',
  '--exec-path',
  '--git-dir',
  '--namespace',
  '--super-prefix',
  '--work-tree',
]);

// Returns { subcommand, sub } where:
//   subcommand: 'stash' | 'worktree' | null
//   sub:        the token immediately after the subcommand (for context)
function nextRelevantSubcommand(tokens, gitIndex) {
  let index = gitIndex + 1;

  while (index < tokens.length && tokens[index] !== '__CMD_SEPARATOR__') {
    const current = tokens[index];

    if (gitOptionsWithValue.has(current)) {
      index += 2;
      continue;
    }

    if (current.startsWith('--') && current.includes('=')) {
      index += 1;
      continue;
    }

    if (current.startsWith('-')) {
      index += 1;
      continue;
    }

    if (current === 'stash' || current === 'worktree') {
      return { subcommand: current, sub: tokens[index + 1] || '' };
    }
    return null;
  }

  return null;
}

// Worktree subcommands that mutate `.git/worktrees/` state shared with
// concurrent agents. `list` is read-only and stays allowed.
const BLOCKED_WORKTREE_SUBS = new Set([
  'add',
  'remove',
  'move',
  'lock',
  'unlock',
  'prune',
  'repair',
]);

let command = '';

try {
  const payload = JSON.parse(process.env.HOOK_INPUT || '{}');
  command = String(payload.command || '');
} catch (error) {
  emit({
    permission: 'deny',
    user_message: 'BLOCKED by git-safety hook: could not parse shell command JSON.',
    agent_message: 'The git-safety hook could not parse the shell command JSON. Do not retry with git stash.',
  });
  process.exit(0);
}

const tokens = parseShellWords(command);

for (let index = 0; index < tokens.length; index += 1) {
  if (!isGitToken(tokens[index])) {
    continue;
  }

  const match = nextRelevantSubcommand(tokens, index);
  if (!match) continue;

  if (match.subcommand === 'stash') {
    if (match.sub === 'list' || match.sub === 'show') continue;

    const message = `BLOCKED by git-safety rule.

\`git stash\` (including \`pop\`, \`apply\`, \`drop\`, \`push\`) is forbidden in this repository. Multiple agents work on this codebase concurrently; stashing can silently capture or destroy another agent's in-flight changes.

REQUIRED: In your reply to the user, acknowledge this exactly:
  "I violated your \`git-safety\` rule by running \`${command}\`."

Then continue the task without using stash. If you need to set aside changes, ask the user how they want to isolate the work instead.`;

    emit({
      permission: 'deny',
      user_message: message,
      agent_message: message,
    });
    process.exit(0);
  }

  if (match.subcommand === 'worktree') {
    if (!BLOCKED_WORKTREE_SUBS.has(match.sub)) continue;

    const message = `BLOCKED by git-safety rule.

\`git worktree ${match.sub}\` is forbidden in this repository. Multiple agents share \`.git/worktrees/\` state; \`add\` / \`remove\` / \`move\` / \`lock\` / \`unlock\` / \`prune\` / \`repair\` can interfere with another agent's checkout. \`git worktree list\` is fine.

REQUIRED: In your reply to the user, acknowledge this exactly:
  "I violated your \`git-safety\` rule by running \`${command}\`."

Then continue the task without using \`git worktree ${match.sub}\`. If you need an isolated checkout for diagnosis, ask the user how they want to set it up instead.`;

    emit({
      permission: 'deny',
      user_message: message,
      agent_message: message,
    });
    process.exit(0);
  }
}

emit({ permission: 'allow' });
NODE
