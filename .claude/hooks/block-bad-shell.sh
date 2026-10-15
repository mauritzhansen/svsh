#!/usr/bin/env bash
# PreToolUse hook for Bash. HARD-BLOCKS commands that violate the shell
# idioms in CLAUDE.local.md: shell `for`/`while`/`until`/`select` loops and
# `$(...)`/backtick command substitution. Blocking (exit 2 + stderr) feeds a
# coaching message back to the model so it rewrites the command itself —
# the user never sees a permission prompt for these.
#
# Also blocks process substitution `<(…)` / `>(…)` (same family).
#
# Quote-/escape-/heredoc-aware (shared _shellscan tokenizer) with the
# correct two-tier model: SINGLE-quoted text and quoted-heredoc bodies are
# literal (a `for`/`$(` inside '…', a grep pattern, or a `<<'EOF'` body is
# NOT blocked), but DOUBLE-quoted `"$(cmd)"` and UNquoted-heredoc `$(…)`
# DO execute, so they ARE blocked. Loop keywords only trip in command
# position. Fails OPEN (exit 0) on any parse/runtime error.

input=$(cat)

command -v python3 >/dev/null 2>&1 || exit 0

HOOK_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

HOOK_INPUT="$input" HOOK_DIR="$HOOK_DIR" python3 <<'PYEOF'
import json, os, re, sys

try:
    payload = json.loads(os.environ.get("HOOK_INPUT") or "{}")
except Exception:
    sys.exit(0)  # fail open

if payload.get("tool_name") not in (None, "Bash"):
    sys.exit(0)

cmd = (payload.get("tool_input") or {}).get("command") or ""
if not cmd:
    sys.exit(0)

# Shared shell tokenizer — single source of truth (see _shellscan.py).
#   skeleton      (ops)  single AND double quoted + escaped + heredoc
#                         BODIES blanked. Loop / process-sub / heredoc
#                         detection (a real one is never quoted/in a body).
#   skeleton_csub (csub) double-quoted KEPT, and an UNquoted heredoc body
#                         kept (it still expands $()), so command
#                         substitution that actually executes is caught;
#                         a literal `'$(x)'` / quoted-heredoc body is not.
try:
    sys.path.insert(0, os.environ.get("HOOK_DIR", ""))
    from _shellscan import scan
    skeleton, skeleton_csub, _segs = scan(cmd)
except Exception:
    sys.exit(0)  # fail open

# Command substitution — real when UNQUOTED or inside DOUBLE quotes
# (single-quoted `'$(x)'` is literal and exempt). Includes arithmetic
# `$((…))` and backticks, mirroring allow-safe-commands.sh.
if "$(" in skeleton_csub or "`" in skeleton_csub:
    sys.stderr.write(
        "Blocked by CLAUDE.local.md shell idioms: $(...) / backtick command "
        "substitution (incl. inside double quotes, where it still executes) "
        "is forbidden in Bash here.\n"
        "Rewrite without command substitution — run the inner command as its "
        "own separate Bash tool call and use its output, or restructure so "
        "each Bash call is one simple command. (Single-quoted '$(literal)' is "
        "fine if you truly need the literal text.)\n"
    )
    sys.exit(2)

# Exit-status capture (`echo "exit=${PIPESTATUS[0]}"`, `…; echo rc=$?`) —
# added 2026-09-01 after a gate agent's `gitleaks … | tail -5; echo
# "exit=${PIPESTATUS[0]}"` reached Timo as a "contains expansion" prompt.
# The harness flags every `$…` expansion as unanalysable, so this shape
# can never be allowlisted — and it is never needed: the Bash tool result
# already carries the command's exit code. Real when unquoted or in double
# quotes (skeleton_csub); a single-quoted grep pattern is literal.
if re.search(r"\$\{?PIPESTATUS\b", skeleton_csub) or re.search(r"\$\?", skeleton_csub):
    sys.stderr.write(
        "Blocked by CLAUDE.local.md shell idioms: capturing an exit status "
        "(`$?`, `${PIPESTATUS[n]}`) is forbidden in Bash here — the tool "
        "result already reports the command's exit code.\n"
        "Run the command ALONE as its own Bash call (no `| tail`, no `; echo "
        "exit=…`); use the tool's flags (`--report-path`, `--quiet`) to keep "
        "output short instead of a pipe.\n"
    )
    sys.exit(2)

# Process substitution `<(…)` / `>(…)` — spawns a subcommand, same family.
if re.search(r"[<>]\(", skeleton):
    sys.stderr.write(
        "Blocked by CLAUDE.local.md shell idioms: process substitution "
        "`<(…)` / `>(…)` is forbidden in Bash here.\n"
        "Run the inner commands as separate Bash tool calls writing to /tmp "
        "files, then operate on those files, e.g. `sort a > /tmp/a; sort b > "
        "/tmp/b; diff /tmp/a /tmp/b`.\n"
    )
    sys.exit(2)

# Piping INTO an interpreter that executes its stdin (`curl … | sh`,
# `… | bash -s`, `… | python3 -`, bare `… | python3`) — added
# 2026-08-30. This must live HERE, not in allow-safe-commands.sh: a
# static prefix rule like `Bash(curl *)` matches the whole compound
# string, so only a hard block stops the pipe-to-shell class. A pipe
# into an interpreter WITH a script-file operand (`… | sh hook.sh`,
# `… | python3 parse.py`) feeds it DATA, not code, and stays allowed.
if re.search(r"\|\s*(?:sudo\s+)?(?:env\s+)?(?:sh|bash|zsh|ksh|dash)((?:\s+-[A-Za-z-]+)*)\s*(?:$|[|;&])", skeleton) or \
   re.search(r"\|\s*(?:sudo\s+)?(?:python3?|node)\s+-\s*(?:$|[|;&])", skeleton) or \
   re.search(r"\|\s*(?:sudo\s+)?(?:python3?|node|perl|ruby)\s*(?:$|[|;&])", skeleton):
    sys.stderr.write(
        "Blocked by CLAUDE.local.md shell idioms: piping into an "
        "interpreter that executes its stdin (`… | sh`, `… | bash -s`, "
        "`… | python3 -`, bare `… | python3`) is forbidden in Bash here.\n"
        "Write the script to a file with the Write tool and run it as its "
        "own command (`python3 /tmp/x.py`), or pass a script FILE operand "
        "so stdin is data (`… | sh hook.sh` is fine).\n"
    )
    sys.exit(2)

# Loop keyword in COMMAND position: at start, or right after a control
# operator / newline / `do` / `then` / grouping.
pieces = re.split(r"(?:&&|\|\||[;|\n&])", skeleton)
LOOP = {"for", "while", "until", "select"}
for p in pieces:
    p = p.strip()
    while p:
        m = re.match(r"(time|!|\{|\(|then|do)\b\s*", p)
        if not m:
            break
        p = p[m.end():].strip()
    if not p:
        continue
    first = re.split(r"\s", p, maxsplit=1)[0]
    if first in LOOP:
        sys.stderr.write(
            "Blocked by CLAUDE.local.md shell idioms: shell `%s` loops are "
            "forbidden in Bash here.\n"
            "Rewrite as a SINGLE multi-file invocation instead of looping, "
            "e.g. `grep -cE PATTERN f1 f2 f3` rather than "
            "`for f in ...; do grep ... $f; done`. To run a sequence, issue "
            "separate Bash tool calls (one simple command each).\n" % first
        )
        sys.exit(2)

# Prod-credential scripts in EXECUTION position (2026-09-02, caught live by
# Timo: an agent opened migrations/psql-prod.sh "to check the backlog").
# psql-prod.sh and migrate-prod.sh fetch the FULL-PRIVILEGE prod application
# credential from Secrets Manager; "read-only by default" is an accident
# guardrail, not a reduced-privilege role. They are OWNER-RUN ONLY — no
# agent session ever executes them, and a prompt is one wrong click from a
# privileged prod session, so this is a hard block, not a prompt. Reading or
# searching the files stays allowed (reader-leader exemption below), and a
# single-quoted mention is literal (skeleton). Prod READS go through the
# mcp_readonly path per the `database` skill.
PROD_CRED = re.compile(r"(^|/)(psql-prod|migrate-prod)\.sh$")
READERS = {"grep", "rg", "cat", "head", "tail", "wc", "ls", "stat", "file",
           "git", "diff", "awk", "cut", "sort", "echo", "printf", "less",
           "shellcheck", "bat", "md5", "shasum"}
for p in re.split(r"(?:&&|\|\||[;|\n&])", skeleton):
    p = p.strip()
    while p:
        m = re.match(r"(?:(?:time|!|\{|\(|then|do|sudo|nohup|setsid|command|exec)\b|timeout\s+\S+|env(?:\s+\w+=\S*)*)\s+", p)
        if not m:
            break
        p = p[m.end():].strip()
    toks = [t.strip("\"'") for t in p.split()]
    if not toks:
        continue
    if any(PROD_CRED.search(t) for t in toks) and toks[0] not in READERS:
        sys.stderr.write(
            "BLOCKED: migrations/psql-prod.sh and migrate-prod.sh fetch the "
            "FULL-PRIVILEGE prod application credential — they are owner-run "
            "ONLY (Timo's ruling 2026-09-02); no agent executes them, and "
            "the psql-prod.sh read-only default is an accident guardrail, "
            "not a reduced-privilege role.\n"
            "For prod READS use the mcp_readonly path per the `database` "
            "skill. To inspect the script itself, use the Read tool or "
            "grep/cat. If the op itself is needed, it goes on the Board as a "
            "\"⚠ Waiting on Timo\" action row with the paste-ready command.\n"
        )
        sys.exit(2)

# Cherry-pick / revert in the MAIN CHECKOUT (2026-09-03, two live prompts
# the same morning: breeding-rebuild and reports-w1-rebuild, each replaying
# a chain of Timo's stranded 09-02 commits). In an agent's own worktree this
# is legitimate recovery — no wrapper covers reassembling a chain that never
# landed, since agent-rebase.mjs only rebases an existing branch onto dev.
# In the MAIN checkout it is two failures at once: `--no-commit` stages a
# whole commit's diff into the index every other agent commits against and
# leaves CHERRY_PICK_HEAD sequencer state that wedges the shared tree (the
# only cleanups are `reset`/`restore`, both banned), and the committing form
# puts unreviewed commits straight onto dev, bypassing review and the
# ff-only agent-integrate.mjs gate entirely.
#
# The tree is NOT in the command text — a worktree agent issues a bare
# `git cherry-pick <sha>` — so it is resolved as: an explicit `git -C <path>`
# target if present, else the payload `cwd`. Three-way, per the hook rules:
#   worktree (path under .claude/worktrees/)  -> not blocked here
#   main checkout (inside the repo, not a worktree) -> HARD BLOCK
#   unknown (no cwd in payload, path outside the repo) -> fall through to
#     the normal PROMPT. Never a silent allow, never a blind block.
# `git cherry` (a read verb, already allowlisted) must NOT collide with
# `cherry-pick`; the token match is exact.
REPO_ROOT = os.path.dirname(os.path.dirname(os.environ.get("HOOK_DIR", "")))
WORKTREES = os.path.join(REPO_ROOT, ".claude", "worktrees") if REPO_ROOT else ""
SEQ_VERBS = {"cherry-pick", "revert"}


def _tree_kind(path):
    """worktree | main | unknown — never guesses."""
    if not path or not REPO_ROOT:
        return "unknown"
    p = os.path.normpath(path)
    if not os.path.isabs(p):
        return "unknown"
    if p == WORKTREES or p.startswith(WORKTREES + os.sep):
        return "worktree"
    if p == REPO_ROOT or p.startswith(REPO_ROOT + os.sep):
        return "main"
    return "unknown"


payload_cwd = payload.get("cwd") or ""
for p in re.split(r"(?:&&|\|\||[;|\n&])", skeleton):
    p = p.strip()
    while p:
        m = re.match(r"(?:(?:time|!|\{|\(|then|do|sudo|nohup|setsid|command|exec)\b|timeout\s+\S+|env(?:\s+\w+=\S*)*)\s+", p)
        if not m:
            break
        p = p[m.end():].strip()
    toks = [t.strip("\"'") for t in p.split()]
    if not toks or toks[0] != "git":
        continue
    # `-C <path>` retargets the command regardless of cwd.
    target, rest = payload_cwd, toks[1:]
    while rest and rest[0] in ("-C", "--git-dir", "--work-tree"):
        if len(rest) < 2:
            break
        if rest[0] == "-C":
            target = rest[1]
        rest = rest[2:]
    verb = next((t for t in rest if not t.startswith("-")), "")
    if verb not in SEQ_VERBS:
        continue
    if _tree_kind(target) != "main":
        continue
    sys.stderr.write(
        "BLOCKED: `git %s` in the MAIN CHECKOUT. This is a shared working "
        "tree — `--no-commit` stages a whole commit's diff into the index "
        "other agents are committing against and leaves CHERRY_PICK_HEAD "
        "sequencer state that wedges the tree (the only cleanups, `reset` "
        "and `restore`, are banned), and the committing form puts "
        "unreviewed commits straight onto dev, bypassing adversarial "
        "review and the ff-only agent-integrate.mjs gate.\n"
        "Do it in YOUR OWN worktree instead: `node scripts/worktree-setup.mjs` "
        "(or `--continue-from <sha>`), replay there, then hand the branch tip "
        "to review and integrate as usual. Rebasing an EXISTING branch onto "
        "dev is `node scripts/agent-rebase.mjs`, never a hand-rolled replay.\n"
        "A `--no-commit` chain has no per-commit checkpoint: if a later pick "
        "conflicts it resolves with the earlier ones already staged and the "
        "loss is invisible in the squashed result — prove the rebuilt tree "
        "equals the sum of the originals (empty `git diff` against the source "
        "commit's tree), don't rely on \"it applied cleanly\".\n" % verb
    )
    sys.exit(2)

# Authoring a file via a shell heredoc + real-file redirect
# (`cat > path <<'EOF' … EOF`, `tee path <<EOF`). The header line (up to
# the first newline) carries the `<<` operator and the `>` redirect; the
# heredoc BODY is excluded so its `>` / `<<` text can't false-trigger.
header = skeleton.split("\n", 1)[0]
for noise in ("2>/dev/null", "&>/dev/null", ">/dev/null",
              "2>&1", "1>&2", ">&2", ">&1"):
    header = header.replace(noise, "")
if "<<" in header and (re.search(r">>?\s*[^&\s]", header)
                        or re.search(r"\btee\b", header)):
    sys.stderr.write(
        "Blocked by CLAUDE.local.md shell idioms: do not author files with a "
        "shell heredoc + redirect (`cat > FILE <<'EOF' … EOF`).\n"
        "Use the Write tool to create the file (it needs no permission and "
        "won't prompt the user), then run the command separately, e.g. "
        "`pnpm --dir api exec vitest run /tmp/x.test.js`. For multi-line git "
        "commit messages use `git commit -F /tmp/msg.txt` (Write the file "
        "first).\n"
    )
    sys.exit(2)

# In-place file mutation via `sed -i` / `perl -i…` — should be the Edit
# tool (auto-approved, reviewable, supports replace_all). Skeleton is
# quote-aware so `grep "sed -i" f` is not blocked.
if re.search(r"(^|[^\w./-])sed\s+(-[A-Za-z]*i|--in-place)", skeleton) or \
   re.search(r"(^|[^\w./-])perl\s+-[A-Za-z]*p?i", skeleton):
    sys.stderr.write(
        "Blocked by CLAUDE.local.md shell idioms: in-place stream-editing "
        "(`sed -i` / `perl -i`) of a file is forbidden in Bash here.\n"
        "Use the Edit tool instead (it needs no permission, is reviewable, "
        "and `replace_all: true` does a global rename). For a brand-new "
        "file use the Write tool.\n"
    )
    sys.exit(2)

sys.exit(0)
PYEOF
rc=$?
[ "$rc" = "2" ] && exit 2
exit 0
