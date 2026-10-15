"""block-stash.sh — two refusals: `git stash` (mutating forms) and
`git worktree` (mutating subcommands).

The adapter at `.claude/hooks/block-stash.sh` translates Claude Code hook
I/O and delegates the decision to `.cursor/hooks/block-stash.sh`, so this
suite exercises BOTH halves through the adapter — the way the chain calls
it — rather than testing the policy in isolation.

Every BLOCK case is paired with a must-allow that differs in exactly one
token, so a hook that refuses everything containing the word "stash" (or
every `git worktree`) cannot pass. The read-only escapes are the pairs that
matter most: `stash list` / `stash show` / `worktree list` are how an agent
diagnoses the very state this hook protects, and a blanket deny would make
the tree unreadable while still not preventing a single data loss.

FAILS OPEN, deliberately and unlike block-bare-commit.py's subject: this
hook runs in the Bash chain for EVERY command, and its decision comes from
a delegate it spawns. Unparseable input, a missing delegate, a delegate
that errors, or delegate output that is not JSON all exit 0. The cases at
the bottom pin that, because the alternative — a blanket deny when the
adapter is confused — bricks a session over commands that were never
`git stash`. The trade is accepted knowingly: this hook is a guard against
an agent's habit, not a security boundary, and `git stash` is denied by a
permission rule as well.

Not covered here (needs the delegate moved, which this suite will not do
to a shared checkout): the missing-`.cursor/hooks/block-stash.sh` path.
"""
import json, os, subprocess, sys

# Invoke via the hook's own shebang, the way the chain does, rather than
# forcing an interpreter — `["sh", HOOK]` would ignore the shebang forever
# and pass locally under one shell while CI goes red under another. See the
# same note in test_block_bare_commit.py.
HOOK = os.path.join(os.path.dirname(__file__), "..", "block-stash.sh")
PROJECT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


def run(payload):
    body = payload if isinstance(payload, str) else json.dumps(payload)
    r = subprocess.run([HOOK], input=body, capture_output=True, text=True,
                       env=dict(os.environ, CLAUDE_PROJECT_DIR=PROJECT))
    return r.returncode == 2, r.stderr


def bash(command):
    return {"hook_event_name": "PreToolUse", "tool_name": "Bash", "session_id": "s1",
            "tool_input": {"command": command}}


STASH = "git-safety rule"
CASES = [
    # ── git stash: the refusal, and the two read-only escapes ────────────
    ("bare `git stash` -> BLOCK", bash("git stash"), True, STASH),
    ("…`git stash list` -> allow (diagnosis must stay possible)", bash("git stash list"), False, ""),
    ("…`git stash show` -> allow", bash("git stash show"), False, ""),
    ("`git stash pop` -> BLOCK", bash("git stash pop"), True, STASH),
    ("`git stash apply` -> BLOCK", bash("git stash apply"), True, STASH),
    ("`git stash drop` -> BLOCK", bash("git stash drop"), True, STASH),
    ("`git stash push -m x` -> BLOCK", bash("git stash push -m x"), True, STASH),

    # ── git worktree: mutating subs blocked, `list` explicitly not ───────
    ("`git worktree add` -> BLOCK", bash("git worktree add /w/tree branch"), True, STASH),
    ("…`git worktree list` -> allow", bash("git worktree list"), False, ""),
    ("`git worktree remove` -> BLOCK", bash("git worktree remove /w/tree"), True, STASH),
    ("`git worktree move` -> BLOCK", bash("git worktree move /a /b"), True, STASH),
    ("`git worktree lock` -> BLOCK", bash("git worktree lock /w/tree"), True, STASH),
    ("`git worktree unlock` -> BLOCK", bash("git worktree unlock /w/tree"), True, STASH),
    ("`git worktree prune` -> BLOCK", bash("git worktree prune"), True, STASH),
    ("`git worktree repair` -> BLOCK", bash("git worktree repair"), True, STASH),

    # ── option-with-value skipping: the value must not be read as the
    #    subcommand. `git -C <dir>` is the shape every worktree agent uses.
    ("`git -C <dir> stash` -> BLOCK", bash("git -C /w/tree stash"), True, STASH),
    ("…`git -C <dir> status` -> allow", bash("git -C /w/tree status"), False, ""),
    ("`git -c a=b stash` -> BLOCK (-c takes a value)", bash("git -c a=b stash"), True, STASH),
    ("`git --git-dir=/x stash` -> BLOCK (--opt=value is one token)", bash("git --git-dir=/x stash"), True, STASH),

    # ── separators: a stash hidden behind && is still a stash ────────────
    ("`npm run build && git stash` -> BLOCK", bash("npm run build && git stash"), True, STASH),
    ("`git status && git worktree list` -> allow", bash("git status && git worktree list"), False, ""),
    ("`git stash` after a `;` -> BLOCK", bash("ls; git stash"), True, STASH),
    ("`git stash` in a pipeline head -> BLOCK", bash("git stash | cat"), True, STASH),

    # ── exact-token matching, both directions ────────────────────────────
    ("MUST-ALLOW — `git stashed` is not `git stash`", bash("git stashed"), False, ""),
    ("MUST-ALLOW — plain `git status` is untouched", bash("git status"), False, ""),
    ("MUST-ALLOW — `git worktree` with no sub is not a mutation", bash("git worktree"), False, ""),
    ("an absolute git path still matches", bash("/usr/bin/git stash"), True, STASH),

    # ── quote-awareness: the pair that proves this is not substring
    #    matching. Quoting makes `git stash` ONE token, which is not `git`.
    ("MUST-ALLOW — `grep \"git stash\" README.md` -> allow (quoted = one token)",
     bash('grep "git stash" README.md'), False, ""),
    ("MUST-ALLOW — a single-quoted mention -> allow",
     bash("rg 'git stash' docs/"), False, ""),
    # …and the honest limit of that: UNQUOTED, the tokens are real tokens,
    # so this blocks. Pinned so the conservative behaviour is a decision on
    # the record rather than a surprise.
    ("KNOWN CONSERVATIVE — unquoted `echo git stash` -> BLOCK",
     bash("echo git stash"), True, STASH),

    # ── scope: not a Bash call at all ────────────────────────────────────
    ("MUST-ALLOW — the same string under a non-Bash tool -> allow",
     {"hook_event_name": "PreToolUse", "tool_name": "Read", "session_id": "s1",
      "tool_input": {"command": "git stash"}}, False, ""),

    # ── fails OPEN (see module docstring) ────────────────────────────────
    ("FAIL-OPEN — input that is not JSON -> allow", "not json at all", False, ""),
    ("FAIL-OPEN — truncated JSON -> allow", "{", False, ""),
    ("FAIL-OPEN — Bash payload with no command -> allow",
     {"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {}}, False, ""),
    ("FAIL-OPEN — empty input -> allow", "", False, ""),
]

failed = 0
for name, payload, expect, needle in CASES:
    blocked, err = run(payload)
    ok = blocked == expect and (not blocked or needle in err)
    print(("ok   " if ok else "FAIL ") + name)
    if not ok:
        failed += 1
        print(f"      blocked={blocked} expected={expect} err={err[:300]!r}")

print(f"{len(CASES) - failed} passed, {failed} failed")
sys.exit(1 if failed else 0)
