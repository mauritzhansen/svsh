"""block-bare-commit.sh — one refusal: `git commit` with no `--` pathspec.

Every BLOCK case is paired with a must-allow that differs in exactly one
thing (the `--` and its paths), so a hook that blocks every commit — or
every command mentioning the word — cannot pass. The fail-closed case
(unparseable input that mentions a commit) is asserted as a block, and its
pair (unparseable input that does not) as an allow, because this hook runs
in the Bash chain for EVERY command and a blanket deny there would brick a
session over commands that were never commits.

The second refusal it carried from 2026-09-09 to 2026-09-10 ("no dev commit
under a live builder") was removed by Timo; the cases at the bottom pin
that a correctly scoped commit in the main checkout is allowed even when a
ledger full of open builder rows is pointed at the hook."""
import json, os, subprocess, sys

HOOK = os.path.join(os.path.dirname(__file__), "..", "block-bare-commit.sh")
MSG = "/tmp/scratch/agent-commit-msg.txt"


# Invoke the hook via its own shebang, the way the chain invokes it, rather
# than forcing an interpreter. This hook declares `#!/bin/sh` today, so the
# two shapes happen to agree — but `["sh", HOOK]` ignores the shebang FOREVER,
# so the day this file (or any hook tested this way) declares bash, the test
# would keep running it under the runner's /bin/sh and pass locally while CI
# goes red. That is exactly how test_allow_sentry_api.py was wired red on
# ubuntu-latest (dash) while green on macOS (bash in POSIX mode).
NO_LEDGER = "/tmp/scratch/no-such-in-flight.json"


def run(payload, ledger=NO_LEDGER):
    # DBP_LEDGER_FILE is still set so the removal of the live-builder rule
    # is PROVEN, not assumed: the cases at the bottom point it at a ledger
    # full of open builder rows and expect the commit to be allowed anyway.
    env = dict(os.environ, DBP_LEDGER_FILE=ledger)
    r = subprocess.run([HOOK], input=json.dumps(payload) if not isinstance(payload, str) else payload,
                       capture_output=True, text=True, env=env)
    return r.returncode == 2, r.stderr


def bash(command):
    return {"hook_event_name": "PreToolUse", "tool_name": "Bash", "session_id": "s1",
            "tool_input": {"command": command}}


CASES = [
    # the refusal, and the same commit with the separator added.
    ("git commit -m with no pathspec -> BLOCK", bash('git commit -m "wip"'), True, "no `--` pathspec"),
    ("…the same commit WITH a -- pathspec -> allow", bash('git commit -m "wip" -- scripts/lead/ledger.mjs'), False, ""),
    # -F form, same pair.
    ("git commit -F with no pathspec -> BLOCK", bash(f"git commit -F {MSG}"), True, "no `--` pathspec"),
    ("…the same commit WITH two paths -> allow", bash(f"git commit -F {MSG} -- scripts/lead/ledger.mjs scripts/lead/wake.mjs"), False, ""),
    # `git -C <dir>` — the shape every worktree agent uses. The value token
    # after -C must not be mistaken for the subcommand.
    ("git -C <dir> commit with no pathspec -> BLOCK", bash('git -C /w/tree commit -m "x"'), True, "no `--` pathspec"),
    ("…the same -C commit WITH a pathspec -> allow", bash('git -C /w/tree commit -m "x" -- a/b.mjs'), False, ""),
    # --amend is a flag, not the separator: a bare amend is still bare.
    ("git commit --amend with no pathspec -> BLOCK", bash("git commit --amend --no-edit"), True, "no `--` pathspec"),
    ("…amend WITH a pathspec -> allow", bash("git commit --amend --no-edit -- a/b.mjs"), False, ""),
    # a separator that selects nothing — the three shapes that reach the
    # whole index THROUGH a `--`. Each pairs with the real pathspec above.
    ("git commit -m x -- (nothing after the separator) -> BLOCK",
     bash('git commit -m "x" --'), True, "NOTHING after it"),
    ("git commit -m x -- . (the whole tree) -> BLOCK",
     bash('git commit -m "x" -- .'), True, "whole tree"),
    ("git commit -m x -- :/ (the whole repo) -> BLOCK",
     bash('git commit -m "x" -- :/'), True, "whole tree"),
    ("git commit -m x -- * (shell-expanded to everything) -> BLOCK",
     bash('git commit -m "x" -- *'), True, "whole tree"),
    ("…the same commit with a real path -> allow",
     bash('git commit -m "x" -- scripts/lead/ledger.mjs'), False, ""),
    ("a real path that merely STARTS with a dot -> allow",
     bash('git commit -m "x" -- .github/workflows/guards.yml'), False, ""),
    # sh -c carries a whole second command inside one token.
    ("sh -c with a bare commit inside -> BLOCK",
     bash('sh -c "git commit -m x"'), True, "no `--` pathspec"),
    ("…the same sh -c with a pathspec inside -> allow",
     bash('sh -c "git commit -m x -- scripts/lead/ledger.mjs"'), False, ""),
    ("bash -lc with a bare commit inside -> BLOCK",
     bash('bash -lc "git -C /w/tree commit --amend --no-edit"'), True, "no `--` pathspec"),
    # not a commit at all.
    ("git status -> allow", bash("git status --porcelain"), False, ""),
    ("git add of a new file -> allow", bash("git add scripts/tests/doctrine.test.mjs"), False, ""),
    ("a command whose QUOTED text mentions a commit -> allow", bash('echo "run git commit -m x -- path"'), False, ""),
    ("grep for the word commit -> allow", bash("grep -n commit scripts/README.md"), False, ""),
    # other tools are not this hook is business.
    ("Agent tool payload mentioning a commit -> allow",
     {"hook_event_name": "PreToolUse", "tool_name": "Agent",
      "tool_input": {"prompt": "commit with git commit -m x"}}, False, ""),
    ("payload without tool_input -> allow", {"hook_event_name": "PreToolUse", "tool_name": "Bash"}, False, ""),
]

failed = 0
for name, payload, expect, needle in CASES:
    blocked, err = run(payload)
    ok = blocked == expect and (not blocked or needle in err)
    print(("ok   " if ok else "FAIL ") + name)
    if not ok:
        failed += 1
        print(f"      blocked={blocked} expected={expect} err={err[:200]!r}")

# fail-closed pair: the same unparseable input, differing only in whether the
# raw bytes mention a commit.
blocked, err = run('{"tool_name": "Bash", "tool_input": {"command": "git commit -m')
ok = blocked and "could not be parsed" in err
print(("ok   " if ok else "FAIL ") + "malformed payload mentioning a commit -> BLOCK (fail closed)")
failed += 0 if ok else 1

blocked, err = run('{"tool_name": "Bash", "tool_input": {"command": "pnpm --dir api test')
ok = not blocked
print(("ok   " if ok else "FAIL ") + "malformed payload NOT mentioning a commit -> allow")
failed += 0 if ok else 1

# an unbalanced quote inside a real commit command: shlex cannot tokenise it,
# so the pathspec cannot be confirmed.
blocked, err = run(bash('git commit -m "unterminated -- scripts/lead/ledger.mjs'))
ok = blocked and "could not be tokenised" in err
print(("ok   " if ok else "FAIL ") + "untokenisable commit command -> BLOCK (fail closed)")
failed += 0 if ok else 1

# ── the live-builder rule is GONE (Timo 2026-09-10) ───────────────────────
# From 2026-09-09 the hook also refused a scoped commit in the main checkout
# while the ledger held an open builder row. On a fleet that always has one
# open, that held every one-line change all day. These cases pin the
# removal: the ledger is full of open builders and the commit is allowed;
# only the pathspec rule still decides. Each pair differs in the pathspec.
import tempfile
GOOD = 'git commit -m "x" -- scripts/lead/ledger.mjs'
MAIN = "/Users/someone/Source/dbp"
WT = "/Users/someone/Source/dbp/.claude/worktrees/agent-abc123"


def bash_at(command, cwd):
    p = bash(command)
    p["cwd"] = cwd
    return p


with tempfile.TemporaryDirectory() as td:
    live = os.path.join(td, "live.json")
    with open(live, "w") as fh:
        json.dump([{"id": "emails-b1", "kind": "agent", "role": "builder", "status": "open", "plan": "lifecycle-emails"},
                   {"id": "emails-r1", "kind": "agent", "role": "reviewer", "status": "open", "plan": "lifecycle-emails"}], fh)
    broken = os.path.join(td, "broken.json")
    with open(broken, "w") as fh:
        fh.write("{not json")

    LIVE_CASES = [
        ("MUST-ALLOW — a scoped commit in the MAIN checkout with an open builder row on the ledger -> allow",
         bash_at(GOOD, MAIN), live, False, ""),
        ("…git -C <main> from a worktree cwd, same open builder -> allow",
         bash_at('git -C ' + MAIN + ' commit -m "x" -- a/b.mjs', WT), live, False, ""),
        ("…an UNREADABLE ledger changes nothing either (the hook no longer reads one) -> allow",
         bash_at(GOOD, MAIN), broken, False, ""),
        ("…and the one rule left still decides: a BARE commit under the same ledger -> BLOCK on the pathspec",
         bash_at('git commit -m "x"', MAIN), live, True, "no `--` pathspec"),
    ]
    live_total = len(LIVE_CASES)
    for name, payload, ledger, expect, needle in LIVE_CASES:
        blocked, err = run(payload, ledger)
        ok = blocked == expect and (not blocked or needle in err)
        print(("ok   " if ok else "FAIL ") + name)
        if not ok:
            failed += 1
            print(f"      blocked={blocked} expected={expect} err={err[:300]!r}")

# ── --pathspec-from-file is a real pathspec (2026-09-10) ──────────────────
# The hook used to test for a literal `--` TOKEN and so refused this equally
# scoped form. Accepting the FLAG alone would have been a hole, so the pairs
# below are built the other way round from the rest of this file: the
# must-fails prove the hook actually READS the file, not just that the flag
# is spelled right. Case "file listing . -> BLOCK" is the one that cannot be
# passed by any implementation that trusts the flag on sight.
with tempfile.TemporaryDirectory() as td:
    good = os.path.join(td, "paths.txt")
    with open(good, "w") as fh:
        fh.write("scripts/lead/ledger.mjs\nscripts/lead/wake.mjs\n")
    empty = os.path.join(td, "empty.txt")
    with open(empty, "w") as fh:
        fh.write("\n \n\n")
    dotted = os.path.join(td, "dot.txt")
    with open(dotted, "w") as fh:
        fh.write("scripts/lead/ledger.mjs\n.\n")
    quoted = os.path.join(td, "quoted.txt")
    with open(quoted, "w") as fh:
        fh.write('  "."  \n')
    nul_dot = os.path.join(td, "nul-dot.txt")
    with open(nul_dot, "wb") as fh:
        fh.write(b"scripts/lead/ledger.mjs\0.\0")
    nul_good = os.path.join(td, "nul-good.txt")
    with open(nul_good, "wb") as fh:
        fh.write(b"scripts/lead/ledger.mjs\0scripts/lead/wake.mjs\0")
    missing = os.path.join(td, "no-such-file.txt")
    # An open-builder ledger, rebuilt here (the one above lives in a tempdir
    # already torn down), to prove the from-file shape is not held by the
    # removed rule either.
    live = os.path.join(td, "live.json")
    with open(live, "w") as fh:
        json.dump([{"id": "emails-b1", "kind": "agent", "role": "builder",
                    "status": "open", "plan": "lifecycle-emails"}], fh)

    PSF_CASES = [
        # the regression itself, both spellings.
        (f"--pathspec-from-file=<file> -> allow (the shape the hook used to refuse)",
         bash(f"git commit -F {MSG} --pathspec-from-file={good}"), NO_LEDGER, False, ""),
        ("--pathspec-from-file <file> (space form) -> allow",
         bash(f"git commit -F {MSG} --pathspec-from-file {good}"), NO_LEDGER, False, ""),
        # …and the same command with no file, which is NOT scoped.
        ("--pathspec-from-file with nothing after it -> BLOCK",
         bash(f"git commit -F {MSG} --pathspec-from-file"), NO_LEDGER, True, "no file after it"),
        ("--pathspec-from-file followed by another OPTION -> BLOCK (that is a missing value)",
         bash(f"git commit -F {MSG} --pathspec-from-file --amend"), NO_LEDGER, True, "no file after it"),
        ("--pathspec-from-file - (paths on stdin) -> BLOCK (uninspectable)",
         bash(f"git commit -F {MSG} --pathspec-from-file=-"), NO_LEDGER, True, "from stdin"),
        ("--pathspec-from-file naming a file that does not exist -> BLOCK (fail closed)",
         bash(f"git commit -F {MSG} --pathspec-from-file={missing}"), NO_LEDGER, True, "could not be read"),
        ("--pathspec-from-file naming an empty file -> BLOCK",
         bash(f"git commit -F {MSG} --pathspec-from-file={empty}"), NO_LEDGER, True, "no paths at all"),
        # THE must-fail: the flag is spelled correctly and the file exists, so
        # only an implementation that reads its CONTENTS can block this.
        ("MUST-FAIL — a pathspec file listing `.` -> BLOCK (whole tree, wearing a file)",
         bash(f"git commit -F {MSG} --pathspec-from-file={dotted}"), NO_LEDGER, True, "whole tree"),
        ("MUST-FAIL — a padded, C-quoted `.` in the file -> BLOCK (unwrapped before the test)",
         bash(f"git commit -F {MSG} --pathspec-from-file={quoted}"), NO_LEDGER, True, "whole tree"),
        # --pathspec-file-nul changes the separator the file is read with.
        ("--pathspec-file-nul with a NUL file of real paths -> allow",
         bash(f"git commit -F {MSG} --pathspec-from-file={nul_good} --pathspec-file-nul"), NO_LEDGER, False, ""),
        ("MUST-FAIL — --pathspec-file-nul with a NUL file listing `.` -> BLOCK (NUL split is real)",
         bash(f"git commit -F {MSG} --pathspec-from-file={nul_dot} --pathspec-file-nul"), NO_LEDGER, True, "whole tree"),
        # …and the modifier ALONE scopes nothing, so the ordinary rule stands.
        ("MUST-FAIL — --pathspec-file-nul ALONE, no --pathspec-from-file, no -- -> BLOCK",
         bash(f"git commit -F {MSG} --pathspec-file-nul"), NO_LEDGER, True, "no `--` pathspec"),
        ("…--pathspec-file-nul alone WITH a real -- pathspec -> allow",
         bash(f"git commit -F {MSG} --pathspec-file-nul -- scripts/lead/ledger.mjs"), NO_LEDGER, False, ""),
        # the removed live-builder rule does not hold this shape either.
        ("MUST-ALLOW — a from-file commit in the MAIN checkout with an open builder row -> allow",
         bash_at(f"git commit -F {MSG} --pathspec-from-file={good}", MAIN), live, False, ""),
        ("…the same from-file commit from a WORKTREE cwd -> allow",
         bash_at(f"git commit -F {MSG} --pathspec-from-file={good}", WT), live, False, ""),
    ]
    psf_total = len(PSF_CASES)
    for name, payload, ledger, expect, needle in PSF_CASES:
        blocked, err = run(payload, ledger)
        ok = blocked == expect and (not blocked or needle in err)
        print(("ok   " if ok else "FAIL ") + name)
        if not ok:
            failed += 1
            print(f"      blocked={blocked} expected={expect} err={err[:300]!r}")

print(f"{len(CASES) + 3 + live_total + psf_total - failed} passed, {failed} failed")
sys.exit(1 if failed else 0)
