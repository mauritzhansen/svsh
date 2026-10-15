#!/bin/sh
# block-bare-commit.sh — PreToolUse(Bash): a commit without a `--` pathspec
# is refused.
#
# WHY (audit row 66): the deny list already covers `git push`, `git stash`,
# `git rm`, `git add .` and `git add -A`, but NOTHING denies a bare
# `git commit`. Several agents share this working tree and its index at all
# times, so a bare commit sweeps in whatever a sibling left staged and
# carries away work that is not yours — the one git shape CLAUDE.local.md
# names ("The pathspec is what makes the commit yours") that no mechanism
# enforced. A permission rule cannot express it: deny patterns are globs,
# and "contains a bare `--` token somewhere after the subcommand" is not a
# prefix. So it is a hook.
#
# ── What is refused ──────────────────────────────────────────────────────
#
# A `git commit` invocation (including `git -C <dir> commit`) that does not
# name a real path. Three shapes, all of which commit the whole shared
# index:
#
#   1. no bare `--` token after the subcommand — `--amend`, `--all`, `-F`,
#      `-m` and every other flag are NOT the separator; the token must be
#      exactly `--`;
#   2. a `--` with nothing after it;
#   3. a `--` followed by a whole-tree pathspec (`.`, `:/`, `*`, …), which
#      is the separator present and selecting everything anyway.
#
# ── `--pathspec-from-file` is the fourth accepted shape (2026-09-10) ──────
#
# The hook used to test for a literal `--` TOKEN, so it refused
# `git commit --pathspec-from-file=<file>` — a commit that is scoped exactly
# as explicitly, just with the paths in a file. That is a false refusal, and
# its cost is not the inconvenience: it pushes the operator toward retyping
# a long path list inline, or toward the very shapes this hook exists to
# stop. It cost the lead a round on 2026-09-10.
#
# Accepting the flag on sight would have been a hole rather than a fix: the
# file is the pathspec, so it gets the SAME whole-tree test its inline
# equivalent gets. The file is read and its entries checked, which means
# four new refusals, each the from-file twin of a rule that already existed:
#
#   4. `--pathspec-from-file` with no file after it;
#   5. `--pathspec-from-file -` (paths on stdin) — uninspectable before the
#      command runs, so it fails CLOSED like every other blind spot here;
#   6. a file that cannot be read, or that lists no paths at all;
#   7. a file listing a whole-tree pathspec — `-- .` wearing a file.
#
# `--pathspec-file-nul` only changes the SEPARATOR git reads that file with
# (NUL instead of newline), so it is honoured when parsing and is never on
# its own a reason to allow: alone, without `--pathspec-from-file`, it
# scopes nothing and the ordinary `--` requirement still applies.
#
# A shell `-c` string is tokenised and scanned as its own command (up to 3
# levels), because `sh -c "git commit -m x"` is one opaque token to shlex
# and was invisible to the first version of this hook.
#
# Everything else exits 0, including `git commit … -- path/one path/two`,
# every other git subcommand, and every non-git command.
#
# ── Where it is conservative, and in which direction ─────────────────────
#
# The command is tokenised with shlex, and any token `git` (or `…/git`)
# whose first non-option token is `commit` is a commit. Quoted text is one
# token, so `echo "…git commit -m x…"` is invisible to it; UNQUOTED prose
# containing the bare words `git commit` would be refused. That direction is
# deliberate: this hook only ever refuses, never grants, and quoting the
# prose clears it.
#
# ── Fails CLOSED, exactly where it matters ───────────────────────────────
#
# If the hook input or the command cannot be parsed, the decision turns on
# the RAW bytes: they contain the substring `commit`, so a commit that
# cannot be inspected may be in there → DENY, naming the parse failure.
# They do not → exit 0, because the absence of the substring is decisive
# over raw bytes and needs no parser. Unlike the obligation hooks, this one
# sits in the Bash chain for EVERY command, so a blanket deny on malformed
# input would brick a session over a command that was never a commit.
#
# The one deliberate exception: python3 missing exits 0 (see
# lead-waiting-guard.sh for the same note).
#
# ── What this hook no longer does (Timo 2026-09-10) ─────────────────────
#
# From 2026-09-09 to 2026-09-10 it also refused ANY commit in the main
# checkout while the ledger held an open builder row ("no dev commit under a
# live builder"), so that a lead docs commit could not knock a reviewed
# branch off fast-forward. On a fleet that nearly always has a builder open
# that meant nobody could land a one-line change all day; edits piled up as
# "held" and came out later as sweep commits (eight held rows on 2026-09-10).
# Timo removed that half. The cost it guarded against — a branch needing a
# rebase because dev moved — is a builder's few minutes, and with the gate
# now run on the branch before it lands (gate-at-integration) the rebase is
# simply re-gated. The pathspec half above is the safety that matters and
# stays exactly as it was.
#
# Deny = exit 2 + stderr (the PreToolUse contract): the call is blocked and
# stderr goes to the model, which rewrites the command itself.

set -u

INPUT=$(cat 2>/dev/null) || INPUT=""
command -v python3 >/dev/null 2>&1 || exit 0

# NOTE: the python below runs inside a shell single-quoted string; never use
# an apostrophe anywhere in it, comments included.
printf '%s' "$INPUT" | python3 -c '
import json, os, shlex, sys

HOWTO = (
    "Commit with an explicit pathspec instead:\n"
    "  git commit -F <scratchpad>/<agent>-commit-msg.txt -- path/one path/two\n"
    "  git commit -m \"short message\" -- path/one\n"
    "  git commit -F <msg> --pathspec-from-file=<file listing one path per line>\n"
    "New files need `git add <path>` first (never `git add .`)."
)

WHY = (
    "Several agents share this working tree and its index. A commit with no "
    "`--` pathspec commits the WHOLE index, so it carries away whatever a "
    "sibling agent left staged. The pathspec is what makes the commit yours."
)


def deny(msg):
    sys.stderr.write("Blocked (bare git commit): " + msg + "\n" + WHY + "\n" + HOWTO + "\n")
    sys.exit(2)


raw = sys.stdin.read()
looks_like_commit = "commit" in raw

try:
    d = json.loads(raw)
    if not isinstance(d, dict):
        raise ValueError("hook input was not an object")
except Exception as e:
    if looks_like_commit:
        deny("the hook input could not be parsed (" + str(e).replace(chr(39), "") +
             ") and it mentions a commit, so a commit without a pathspec cannot be ruled out.")
    sys.exit(0)

name = d.get("tool_name")
if name not in (None, "Bash"):
    sys.exit(0)
inp = d.get("tool_input")
cmd = (inp or {}).get("command") if isinstance(inp, dict) else ""
cmd = cmd if isinstance(cmd, str) else ""
if "commit" not in cmd:
    sys.exit(0)

try:
    tokens = shlex.split(cmd)
except Exception as e:
    deny("the command could not be tokenised (" + str(e).replace(chr(39), "") +
         ") and it mentions a commit, so a commit without a pathspec cannot be ruled out.")

# git global options that take a SEPARATE value token, so the subcommand is
# the token after the value, not the value itself.
TAKES_VALUE = ("-C", "-c", "--git-dir", "--work-tree", "--namespace",
               "--super-prefix", "--exec-path")

# Pathspecs that mean THE WHOLE TREE. A separator followed by one of these
# is a bare commit wearing a pathspec: `-- .` and `-- :/` stage-and-commit
# everything tracked, and an unquoted `*` is glob-expanded by the shell to
# everything in the directory before git ever sees it.
WHOLE_TREE = (".", "./", ":/", ":/*", "*", "*.*", ":(top)")

SHELLS = ("sh", "bash", "zsh", "dash", "ksh")

# The two flags that move the pathspec into a FILE. PSFN only changes the
# separator PSFF is read with; it scopes nothing by itself.
PSFF = "--pathspec-from-file"
PSFN = "--pathspec-file-nul"


def pathspec_file_value(rest):
    """(present, value) for --pathspec-from-file in both of its spellings.

    value is None when the flag is there with nothing usable after it — a
    following token that is itself an option is a missing value, not a file
    named `--amend`. The one option-looking value git DOES define is `-`
    (stdin), which is kept so the caller can refuse it by name.
    """
    for k, t in enumerate(rest):
        if t.startswith(PSFF + "="):
            return True, t.split("=", 1)[1]
        if t == PSFF:
            nxt = rest[k + 1] if k + 1 < len(rest) else None
            if nxt is None or (nxt.startswith("-") and nxt != "-"):
                return True, None
            return True, nxt
    return False, None


def file_pathspecs(path, base, nul):
    """The pathspec entries git would read out of `path`.

    Read as BYTES and decoded leniently: this runs before the command does,
    so a file it cannot decode must not crash the hook into allowing the
    commit. Entries are stripped, and a C-quoted entry is unwrapped, so a
    quoted or padded `.` is still recognised as the whole tree.
    """
    full = path if os.path.isabs(path) else os.path.join(base, path)
    with open(full, "rb") as fh:
        data = fh.read()
    parts = data.split(b"\0") if nul else data.replace(b"\r\n", b"\n").split(b"\n")
    out = []
    for p in parts:
        s = p.decode("utf-8", "replace").strip()
        if len(s) >= 2 and s[0] == chr(34) and s[-1] == chr(34):
            s = s[1:-1].strip()
        if s:
            out.append(s)
    return out


def is_shell(tok):
    base = tok.rsplit("/", 1)[-1]
    return base in SHELLS


def is_dash_c(tok):
    # `-c`, and bundled short forms where c is last and so takes the command
    # string: `-lc`, `-ec`, `-xc`. Anything starting `--` is a long option.
    if not tok.startswith("-") or tok.startswith("--"):
        return False
    return tok.endswith("c") and len(tok) >= 2


def git_base_dir(gitargs):
    # `git -C <dir>` changes directory before anything else, so it is also
    # what a relative --pathspec-from-file resolves against.
    for k, t in enumerate(gitargs):
        if t == "-C" and k + 1 < len(gitargs):
            return gitargs[k + 1]
    return str(d.get("cwd") or "") or "."


def check_scope(rest, gitargs):
    """Refuse a commit that does not name real paths, by either route.

    The from-file branch is held to the SAME standard as the inline one —
    it is the same pathspec, written down somewhere else — so every refusal
    below has a twin above it.
    """
    present, value = pathspec_file_value(rest)
    if present:
        if value is None:
            deny("this command runs `git commit` with " + PSFF + " and no file after it, "
                 "so what it would commit cannot be read.")
        if value == "-":
            deny("this command runs `git commit` with " + PSFF + " - , which reads the paths "
                 "from stdin — they cannot be inspected before the command runs.")
        try:
            paths = file_pathspecs(value, git_base_dir(gitargs), PSFN in rest)
        except Exception as e:
            deny("this command runs `git commit` with " + PSFF + " " + value +
                 ", which could not be read (" + str(e).replace(chr(39), "") +
                 "), so what it would commit cannot be ruled out.")
        if not paths:
            deny("this command runs `git commit` with " + PSFF + " " + value +
                 ", and that file lists no paths at all, so the commit is scoped to nothing "
                 "and git would commit the whole index.")
        whole = [p for p in paths if p in WHOLE_TREE]
        if whole:
            deny("this command runs `git commit` with " + PSFF + " " + value +
                 ", and that file lists `" + " ".join(whole) + "` — the whole tree. A pathspec "
                 "file selects everything exactly as `-- .` does.")
        return
    if "--" not in rest:
        deny("this command runs `git commit` with no `--` pathspec separator.")
    paths = rest[rest.index("--") + 1:]
    if not paths:
        deny("this command runs `git commit` with a `--` separator and NOTHING after it, "
             "which commits the whole index exactly as a bare commit does.")
    whole = [p for p in paths if p in WHOLE_TREE]
    if whole:
        deny("this command runs `git commit` with `" + " ".join(whole) + "` as a pathspec, "
             "which is the whole tree — the separator is there but it selects nothing.")


def scan(tokens, depth=0):
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        # A shell invoked with -c carries a WHOLE second command in one
        # quoted token, which shlex hands back as a single opaque string.
        # Without this, `sh -c "git commit -m x"` was invisible.
        if is_shell(tok) and depth < 3:
            k = i + 1
            while k < len(tokens) and tokens[k].startswith("-") and not is_dash_c(tokens[k]):
                k += 1
            if k < len(tokens) and is_dash_c(tokens[k]) and k + 1 < len(tokens):
                inner = tokens[k + 1]
                try:
                    inner_tokens = shlex.split(inner)
                except Exception as e:
                    if "commit" in inner:
                        deny("a shell -c command string could not be tokenised (" +
                             str(e).replace(chr(39), "") + ") and it mentions a commit, so a "
                             "commit without a pathspec cannot be ruled out.")
                    inner_tokens = []
                scan(inner_tokens, depth + 1)
                i = k + 2
                continue
        if tok != "git" and not tok.endswith("/git"):
            i += 1
            continue
        j = i + 1
        while j < len(tokens) and tokens[j].startswith("-"):
            j += 1 + (1 if tokens[j] in TAKES_VALUE else 0)
        if j < len(tokens) and tokens[j] == "commit":
            gitargs = tokens[i:j + 1]
            rest = tokens[j + 1:]
            check_scope(rest, gitargs)
        i = j + 1 if j > i else i + 1


scan(tokens)
sys.exit(0)
'
rc=$?
[ "$rc" = "2" ] && exit 2
exit 0
