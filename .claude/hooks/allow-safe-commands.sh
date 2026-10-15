#!/usr/bin/env bash
# PreToolUse hook for Bash. Auto-approves COMPOUND commands the static
# permission allowlist can't match (it matches a whole command string
# against ONE prefix rule, so anything joined by && || ; | / newlines, or
# carrying VAR=… assignments, always falls through to a manual prompt).
#
# Supersedes allow-readonly-inspect.sh + allow-readonly-psql.sh (one hook).
#
# POLICY: "mirror my allowlist".
#   A compound command is auto-approved when EVERY segment leads with a
#   command that is already trusted standalone in
#   .claude/settings.json + .claude/settings.local.json. We never block
#   here — when a segment is not clearly trusted we exit 0 and let the
#   normal permission prompt happen. A separate hard-deny scan makes the
#   genuinely dangerous shapes fall through to a prompt regardless.
#
# Hard-prompt (never auto-approved, even compound):
#   sudo/su, chmod/chown/chgrp, dd/shred/mkfs/fdisk, shutdown/reboot,
#   package+infra managers not on the allowlist (brew/apt/docker/kubectl/
#   gcloud/az/ssh/rsync/…), `git push`, `git stash` (except list/show),
#   `git reset/clean/rebase/merge/...`, `rm` outside /tmp, `ln` without -s,
#   `curl|wget` piped into a shell, redirection to a real file,
#   process substitution, `$(...)`/backtick command substitution,
#   `sed -i`, `find … -delete/-exec`.
#
# Edit the ALLOWED-COMMAND sets below to keep this in sync with
# .claude/settings*.json. See .claude/README.md.

set -euo pipefail

# ── Reviewed repo scripts reached through a WORKTREE path (2026-09-05) ──
# A builder's cwd is its own worktree, so the ordinary way to stand up a
# test database is `bash <wt>/infrastructure/test-db/bootstrap.sh` — and
# that prompted EVERY time, because the script allowlists further down
# only know the main-checkout spelling of those paths.
#
# The `.claude/worktrees/` prefix can never BE the grant: a worktree is
# precisely where an agent writes files freely, so a path shape there
# proves nothing about who authored the script (that is the same reason a
# scratchpad script still prompts). The grant is CONTENT IDENTITY
# instead — the file on disk must hash to the exact blob `dev` carries at
# that path in the main checkout. A script the agent wrote itself, one it
# committed on its own unreviewed branch, and one it edited in place all
# differ from dev and keep prompting; only a byte-identical copy of
# reviewed trunk code is reachable. Same allowlist and the same
# agent-push.sh exclusion as the main-checkout rule, so this widens the
# INVOCATION PATH only, never the set of scripts.
_wt_reviewed_script() {
  _ws=${1:-}
  _ws=${_ws%\"}; _ws=${_ws#\"}; _ws=${_ws%\'}; _ws=${_ws#\'}
  [ -n "$_ws" ] || return 1
  case "$_ws" in *..*) return 1 ;; esac
  _ws_repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd) || return 1
  case "$_ws" in "$_ws_repo/.claude/worktrees/"*) : ;; *) return 1 ;; esac
  _ws_tail=${_ws#"$_ws_repo/.claude/worktrees/"}
  case "$_ws_tail" in */*) : ;; *) return 1 ;; esac
  _ws_rel=${_ws_tail#*/}
  case "$_ws_rel" in
    scripts/*.sh|web-app/e2e/scripts/*.sh|infrastructure/test-db/bootstrap.sh) : ;;
    *) return 1 ;;
  esac
  case "$_ws_rel" in *agent-push.sh) return 1 ;; esac
  [ -f "$_ws" ] || return 1
  # --path makes the hash use the same gitattributes context the reviewed
  # blob was written under; without it a filtered path could never match.
  _ws_dev=$(git -C "$_ws_repo" rev-parse "dev:$_ws_rel" 2>/dev/null) || return 1
  _ws_now=$(git -C "$_ws_repo" hash-object --path "$_ws_rel" -- "$_ws" 2>/dev/null) || return 1
  [ -n "$_ws_dev" ] && [ "$_ws_dev" = "$_ws_now" ]
}

# The whole adjudication body runs inside main(), captured by the caller
# at the bottom of this file. Every `exit 0` fall-through below therefore
# ends only the capture subshell and yields EMPTY output — the caller
# turns that emptiness into either the historical silent prompt (Timo's
# sessions) or an explicit deny (the unwatched engine). Nothing inside
# main() changed with that wrapping.
main() {

cmd=$(jq -r '.tool_input.command // ""')
[ -n "$cmd" ] || exit 0

# Join shell line-continuations (backslash-newline) BEFORE any analysis:
# the shell treats them as a single line, so the hook must too — without
# this, an identical command allowed on one line falls to a prompt when
# an agent formats it across several. awk, not sed: BSD sed's N exits
# unprinted on the last line, which EMPTIED single-line commands here and
# made the hook fail-open (caught by the must-fail suite, 2026-08-26).
_joined=$(printf '%s\n' "$cmd" | awk '{ if (sub(/\\$/,"")) printf "%s ", $0; else print $0 }')
[ -n "$_joined" ] && cmd="$_joined"

# Shared shell tokenizer (single source of truth — see _shellscan.py).
HOOK_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SHELLSCAN="$HOOK_DIR/_shellscan.py"

# Project root, resolved at runtime — never hardcoded to a specific
# developer's checkout path (D-09, remote-workstation plan). ROOT_RE is
# ROOT regex-escaped for the grep -E patterns below; ROOT itself is used
# directly in the (glob, not regex) `case` patterns. If neither
# CLAUDE_PROJECT_DIR nor `git rev-parse` resolves anything, ROOT falls
# back to a sentinel that can never prefix a real path — every grant
# gated on it then fails CLOSED (falls through to a prompt) rather than
# silently widening on an empty match.
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "$ROOT" ] || ROOT="/nonexistent-unresolved-root"
ROOT_RE=$(printf '%s' "$ROOT" | sed 's/[.[\*^$()+?{}|]/\\&/g')

# ── cherry-pick / revert inside an agent's OWN worktree ────────────────
# Rebuilding a stranded commit chain is legitimate recovery no wrapper
# covers (agent-rebase.mjs only rebases an existing branch onto dev), and
# it prompted Timo SIX times in one morning across two rebuild agents.
# In a worktree the index is the agent's own, so the shared-tree hazard
# that keeps these verbs off the allowlist does not exist; in the MAIN
# checkout block-bad-shell.sh hard-denies them outright.
# GRANT ONLY on positive proof: cwd present AND under .claude/worktrees/.
# No cwd, a path outside the repo, or ANY `git -C` (which retargets the
# command away from cwd) => _wt_ok stays 0 and the verb prompts as before.
_repo_root=$(cd "$HOOK_DIR/../.." && pwd)
_wt_root="$_repo_root/.claude/worktrees"
_wt_ok=0
case "${HOOK_CWD_SEEN:-}" in
  "$_wt_root"/*) _wt_ok=1 ;;
esac
if printf '%s' "$cmd" | grep -qE '(^|[^[:alnum:]_-])git[[:space:]]+-C([[:space:]]|$)'; then _wt_ok=0; fi

# ── 0. Read-only psql credential (folded from allow-readonly-psql.sh) ──
# Matches both the bare form and the `set -a && source .env && set +a && …`
# form that settings.json allowlists. Returns early, before the deny scan,
# so the `source` in that pattern does not trip the hard-deny.
# Covers the whole read-only credential FAMILY, not one spelling:
# $PG_READONLY_PASSWORD (dev) and $PG_READONLY_PROD_PASSWORD (prod) both
# name read-only roles, and a per-environment literal here meant every
# prod query prompted while every dev query did not — invisible until a
# builder needed prod. Also now REQUIRES psql, so this is strictly
# narrower than the old rule despite matching more environments: the
# grant is "a read-only credential handed to psql", not "a string
# appears anywhere".
if printf '%s' "$cmd" | grep -qE 'PGPASSWORD="\$PG_READONLY[A-Z_]*"' \
   && printf '%s' "$cmd" | grep -qE '(^|[^[:alnum:]_./-])psql([^[:alnum:]_-]|$)'; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"read-only psql via a $PG_READONLY* credential"}}'
  exit 0
fi

# ── 0b. Local Postgres TEST HARNESS (dbp-postgres-test container) ──────
# `PGPASSWORD=postgres psql -h 127.0.0.1 -p 54320 …` is the harness's
# documented superuser connection — a throwaway container on a loopback
# address and a non-default port, holding only seeded fixtures. Bounded
# HARD to that endpoint: the literal `postgres` password, a loopback
# host, and port 54320 must ALL be present, so nothing here can reach a
# real database. Writes are deliberately permitted (seeding states IS
# the harness's purpose); the blast radius is a container `bootstrap.sh`
# recreates from scratch.
if printf '%s' "$cmd" | grep -qE '(^|[^[:alnum:]_./-])PGPASSWORD=postgres[[:space:]]' \
   && printf '%s' "$cmd" | grep -qE '(^|[^[:alnum:]_./-])psql([^[:alnum:]_-]|$)' \
   && printf '%s' "$cmd" | grep -qE '\-h[[:space:]]+"?(127\.0\.0\.1|localhost)"?' \
   && printf '%s' "$cmd" | grep -qE '\-p[[:space:]]+"?[0-9]+"?'; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"psql to a loopback throwaway (postgres credential, any local port)"}}'
  exit 0
fi
# Any-credential variant (added 2026-08-31, front's request via Timo;
# PGPASSWORD anchor dropped 2026-09-02 — passwordless probes hit the same
# endpoint bound): RLS testing needs throwaway NON-postgres roles
# (non-BYPASSRLS) inside the same loopback harness containers, so the
# password literal cannot be pinned. Bounded by the ENDPOINT alone: psql
# present, loopback -h, and a port in the harness ranges (54xxx/55xxx —
# the shared harness sits on 54320, gate throwaways publish on 554xx).
# Real dev/prod databases are never on loopback high ports here, so no
# credential (or none) can reach a real database through this shape;
# port 5432 deliberately does NOT match.
if printf '%s' "$cmd" | grep -qE '(^|[^[:alnum:]_./-])psql([^[:alnum:]_-]|$)' \
   && printf '%s' "$cmd" | grep -qE '\-h[[:space:]]+"?(127\.0\.0\.1|localhost)"?' \
   && printf '%s' "$cmd" | grep -qE '\-p[[:space:]]+"?5[45][0-9]{3}"?([^0-9]|$)'; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"psql to a loopback harness port (throwaway credential, 54xxx/55xxx only)"}}'
  exit 0
fi

# Same trust, URI form: psql against a loopback throwaway with the
# postgres:postgres credential (any port — loopback is the guarantee).
if printf '%s' "$cmd" | grep -qE '(^|[^[:alnum:]_./-])psql[[:space:]]+"?postgres(ql)?://postgres:postgres@(127\.0\.0\.1|localhost):[0-9]+/'; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"psql URI to a loopback throwaway (postgres:postgres)"}}'
  exit 0
fi

# Any-credential URI form, bounded exactly like the -h/-p flag form above:
# loopback host AND a 54xxx/55xxx harness port (broadcast-w2-review's
# scaffold probe, 2026-09-02). The trust is the ENDPOINT, not the
# credential literal — real databases are never on loopback high ports
# here, and port 5432 deliberately does not match.
if printf '%s' "$cmd" | grep -qE '(^|[^[:alnum:]_./-])psql[[:space:]]+"?postgres(ql)?://[^[:space:]@"]+@(127\.0\.0\.1|localhost):5[45][0-9]{3}/'; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"psql URI to a loopback harness port (any throwaway credential, 54xxx/55xxx only)"}}'
  exit 0
fi

# Loopback harness port probe (2026-09-02, a ci-fix builder's `nc -z -w2
# localhost 54320`): scan-only connectivity check against the same
# 54xxx/55xxx harness ranges the psql carve-outs above trust. FULL-ANCHOR
# match — the entire command must be nc + scan flags + loopback host +
# harness port, so no listener (-l), exec (-e), second host, redirect or
# chained command can ride along. `nc *` as a class stays permanently
# un-allowlistable (arbitrary network I/O, exfil channel). -z is required
# (scan mode never moves data); port 5432 deliberately does NOT match.
if printf '%s' "$cmd" | grep -qE '^nc([[:space:]]+(-z|-v|-zv|-vz|-w[[:space:]]?[0-9]{1,3}))*[[:space:]]+(127\.0\.0\.1|localhost|::1)[[:space:]]+5[45][0-9]{3}[[:space:]]*$' \
   && printf '%s' "$cmd" | grep -qE '(^|[[:space:]])-(z|zv|vz)([[:space:]]|$)'; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"nc -z probe of a loopback harness port (54xxx/55xxx only, scan-only)"}}'
  exit 0
fi

# ── 0b2. WRONG-TARGET TRIPWIRE (2026-08-26 incident class) ─────────────
# A DB-pointing env assignment aimed anywhere but loopback forces a
# PROMPT no matter what the rest of the command is — even if every
# leader is allowlisted. This is the hook-level twin of the fail-closed
# guards added after the dev bulk delete: `DB_HOST=<dev-rds> pnpm
# test:*` was allowlist-green and wiped 36 tables. Legit non-loopback
# database access flows through the read-only psql carve-outs above,
# which return before this line.
if printf '%s' "$cmd" | grep -oE '(^|[[:space:];])(DB_HOST|CBP_DB_HOST|PGHOST|DATABASE_URL)=[^[:space:]]+' | grep -qvE '=(127\.0\.0\.1|localhost)([^0-9.]|$)|=$|=postgres(ql)?://[^@]*@(127\.0\.0\.1|localhost)[:/]'; then
  exit 0
fi

# ── 0c. Gate's throwaway postgres containers (docker run, bounded) ─────
# The pre-push gate runs migrations against a FRESH-VOLUME postgres:*
# container per run (the CI-shaped-bootstrap discipline from the
# 2026-08-26 harness incident). Allowed ONLY when every one of these
# holds: it is `docker run`; the name carries the `dbp-postgres-test-`
# prefix WITH the trailing dash (the shared, deliberately-persistent
# `dbp-postgres-test` container does not match); every published port
# binds 127.0.0.1; the image is postgres:<tag>; no --privileged /
# --pid / host networking; and any -v mount is a read-only path inside
# this repo — or the repo ROOT itself (`-v <repo>:/repo:ro`, 2026-09-06:
# the mount pattern required a `/` after `dbp`, so the whole-repo form
# every gate rehearsal uses prompted while `<repo>/x:/repo:ro` did not).
# The sibling-directory case stays refused: the optional subpath must
# start with `/`, so `dbp-anything` never matches the root alternative.
# Teardown of the same containers (stop/rm/kill/wait) is
# allowed by the same name prefix — and refused if the bare shared
# container name appears anywhere, so the `docker compose down -v`
# class of accident cannot ride through here.
if printf '%s' "$cmd" | grep -qE '(^|[^[:alnum:]_./-])docker[[:space:]]+run([[:space:]]|$)'; then
  _dname=$(printf '%s' "$cmd" | grep -oE -- '--name[[:space:]]+dbp-[a-z0-9-]+' | sed -E 's/--name[[:space:]]+//')
  if [ -n "$_dname" ] && [ "$_dname" != "dbp-postgres-test" ] \
     && printf '%s' "$cmd" | grep -qE "(^|[[:space:]])[\"']?postgres:[0-9]+" \
     && ! printf '%s' "$cmd" | grep -qE -- '--privileged|--pid|--network[= ]host|--net[= ]host|(^|[[:space:]])-P([[:space:]]|$)' \
     && ! printf '%s' "$cmd" | grep -qE -- "-p[[:space:]]+[\"']?([0-9]+:|0\.0\.0\.0|\[?::)" \
     && ! printf '%s' "$cmd" | grep -oE -- "-v[[:space:]]+[\"']?[^[:space:]\"']+" | grep -qvE -- "-v[[:space:]]+[\"']?($ROOT_RE|/(private/)?tmp)(/[^[:space:]\"']*)?:[^[:space:]\"']*:ro$"; then
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"throwaway dbp-postgres-* container (loopback, :ro repo/tmp mounts, never the shared dbp-postgres-test)"}}'
    exit 0
  fi
fi
# The gate's bootstrap of the same throwaway container: env-prefixed,
# loopback-only, repo script by relative or absolute path.
# Three accepted script paths: repo-relative, repo-absolute, or a clean
# commit snapshot extracted under tmp — directly or via a $VAR whose
# assignment to a tmp path appears in the SAME command (the gate's
# CLEAN=<scratchpad> idiom; the var is verified against its local
# assignment, never trusted bare).
_bs_ok=0
# PGHOST may be omitted (the script defaults to the local container) but
# if present anywhere in the command it must be loopback.
if printf '%s' "$cmd" | grep -qE 'PGHOST=' \
   && printf '%s' "$cmd" | grep -oE 'PGHOST=[^[:space:]]+' | grep -qvE '^PGHOST=(127\.0\.0\.1|localhost)$'; then
  _bs_ok=0
elif printf '%s' "$cmd" | grep -qE '(PGHOST=(127\.0\.0\.1|localhost)[[:space:]]+)?PGPORT=[0-9]+[[:space:]]+"?(('"$ROOT_RE"'/|/(private/)?tmp/[^[:space:]"]*/)?infrastructure/test-db/bootstrap\.sh)"?([[:space:]]|$)'; then
  _bs_ok=1
elif printf '%s' "$cmd" | grep -qE '(PGHOST=(127\.0\.0\.1|localhost)[[:space:]]+)?PGPORT=[0-9]+[[:space:]]+"?\$([A-Za-z_][A-Za-z0-9_]*)/infrastructure/test-db/bootstrap\.sh"?([[:space:]]|$)'; then
  _bs_var=$(printf '%s' "$cmd" | grep -oE 'PGPORT=[0-9]+[[:space:]]+"?\$[A-Za-z_][A-Za-z0-9_]*' | grep -oE '\$[A-Za-z_][A-Za-z0-9_]*$' | tr -d '$')
  if [ -n "$_bs_var" ] && printf '%s' "$cmd" | grep -qE "(^|[[:space:];])${_bs_var}=/(private/)?tmp/"; then
    _bs_ok=1
  fi
fi
if [ "$_bs_ok" = 1 ]; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"test-db bootstrap against a loopback throwaway container"}}'
  exit 0
fi

# Teardown: every name ARGUMENT of stop/rm/kill/wait must be a
# dbp-postgres-* name other than the exact shared container. The bare
# shared name elsewhere in the command (e.g. `docker ps --filter
# name=dbp-postgres-test`, a read-only survival check) is fine — only
# the teardown argument position is what must never name it.
if printf '%s' "$cmd" | grep -qE '(^|[^[:alnum:]_./-])docker[[:space:]]+(stop|rm|kill|wait)([[:space:]]|$)'; then
  _targs=$(printf '%s' "$cmd" | grep -oE 'docker[[:space:]]+(stop|rm|kill|wait)([[:space:]]+-[a-z]+)*([[:space:]]+[^[:space:];|&]+)+' | sed -E 's/docker[[:space:]]+(stop|rm|kill|wait)//' | tr ' ' '\n' | grep -vE '^(-|$)' | grep -vE '^[0-9]*[<>]')
  _tok=1
  [ -z "$_targs" ] && _tok=0
  for _n in $_targs; do
    case "$_n" in
      dbp-postgres-test) _tok=0 ;;
      dbp-*) : ;;
      *) _tok=0 ;;
    esac
  done
  if [ "$_tok" = 1 ]; then
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"teardown of throwaway dbp-postgres-* containers (shared dbp-postgres-test excluded by argument)"}}'
    exit 0
  fi
fi

# ── 0c2. docker build of REPO Dockerfiles (CI-equivalent validation) ───
# The pre-push gate builds service images exactly as CI would. Bounded:
# every -f names a Dockerfile inside this repo (or is omitted — the
# default Dockerfile of a repo-path context), the build context is the
# repo or a path inside it (or a tmp snapshot of it), and no host
# secret can enter the build (--secret/--ssh refused). RUN steps
# execute in the container sandbox, same as CI.
if printf '%s' "$cmd" | grep -qE '(^|[^[:alnum:]_./-])docker[[:space:]]+build([[:space:]]|$)'; then
  if ! printf '%s' "$cmd" | grep -qE -- '--secret|--ssh' \
     && ! printf '%s' "$cmd" | grep -qE -- '-f[[:space:]]+[^[:space:]]*\.\.' \
     && ! printf '%s' "$cmd" | grep -oE -- '-f[[:space:]]+[^[:space:]]+' | grep -qvE -- '-f[[:space:]]+(('"$ROOT_RE"'|/(private/)?tmp)/[^[:space:]]*Dockerfile[^[:space:]/]*|[^/[:space:]][^[:space:]]*Dockerfile[^[:space:]/]*)$' \
     && printf '%s' "$cmd" | grep -qE '[[:space:]](\.|'"$ROOT_RE"'[^[:space:]]*|/(private/)?tmp/[^[:space:]]+)[[:space:]]*(2>&1)?[[:space:]]*(\|[[:space:]]*(tail|head|grep)[^;&|]*)?$'; then
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"docker build of a repo Dockerfile with repo/tmp context, no secret mounts"}}'
    exit 0
  fi
fi

# Cleanup of the gate's own test-only images: every rmi argument must
# carry the -prepush-check name convention.
if printf '%s' "$cmd" | grep -qE '(^|[^[:alnum:]_./-])docker[[:space:]]+(rmi|image[[:space:]]+rm)([[:space:]]|$)'; then
  _ri=$(printf '%s' "$cmd" | grep -oE 'docker[[:space:]]+(rmi|image[[:space:]]+rm)([[:space:]]+-[a-z]+)*([[:space:]]+[^[:space:];|&]+)+' | sed -E 's/docker[[:space:]]+(rmi|image[[:space:]]+rm)//' | tr ' ' '\n' | grep -vE '^(-|$)' | grep -vE '^[0-9]*[<>]')
  _ri_ok=1; [ -z "$_ri" ] && _ri_ok=0
  for _im in $_ri; do
    case "$_im" in
      *-prepush-check:*|*-prepush-check|*-verify:*|dbp-*-verify) : ;;
      *) _ri_ok=0 ;;
    esac
  done
  if [ "$_ri_ok" = 1 ]; then
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"removal of the gate'"'"'s own -prepush-check test image(s)"}}'
    exit 0
  fi
fi

# ── 0d. Test runs with env-pinned LOOPBACK databases ───────────────────
# `cd <repo> && DB_HOST=127.0.0.1 … pnpm test:*` is the gate/harness
# idiom for pointing a suite at the throwaway container. The hook's
# general stance (VAR=-prefixed commands always prompt) stays — this
# admits ONE shape, with the wrong-target protection as the condition:
# every *_HOST assignment in the command must be loopback, any cd must
# land inside this repo, the executable must be a pnpm test script, and
# the only tail allowed is 2>&1 into head/tail/grep. A DB_HOST pointing
# at anything non-loopback (dev RDS, prod) still prompts.
_flat=$(printf '%s' "$cmd" | tr -d '\\' | tr '\n' ' ' | tr -s ' ')
_cd_ok=1
for _t in $(printf '%s' "$_flat" | grep -oE 'cd[[:space:]]+"?[^;&|[:space:]]+' | sed -E 's/^cd[[:space:]]+"?//'); do
  case "$_t" in
    "$ROOT"*|/tmp/*|/private/tmp/*) : ;;
    \$*)
      _v=$(printf '%s' "$_t" | sed -E 's/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?.*/\1/')
      printf '%s' "$_flat" | grep -qE "(^|[[:space:];])${_v}=/(private/)?tmp/" || _cd_ok=0 ;;
    *) _cd_ok=0 ;;
  esac
done
if [ "$_cd_ok" = 1 ] \
   && printf '%s' "$_flat" | grep -qE '^[[:space:]]*([A-Za-z_]+=/(private/)?tmp/[^[:space:]]*[[:space:]]+)?(cd[[:space:]]+[^;&|]*&&[[:space:]]*)?([A-Za-z_]+=[^[:space:];&|]*[[:space:]]+)*pnpm[[:space:]]+(--dir[[:space:]]+[^[:space:]]+[[:space:]]+)?(run[[:space:]]+)?test[^;|]*(\|[[:space:]]*(tail|head|grep)[^;&|]*)?[[:space:]]*$' \
   && ! printf '%s' "$_flat" | grep -qE '&&[^&]*&&|test[^;|]*&&' \
   && ! printf '%s' "$_flat" | grep -oE '[A-Za-z_]*HOST=[^[:space:]]+' | grep -qvE 'HOST=(127\.0\.0\.1|localhost)$'; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"pnpm test with all DB hosts pinned to loopback"}}'
  exit 0
fi

# ── 0e. Making REPO shell scripts executable + syntax-checking them ────
# chmod stays hard-denied in general (below). This admits exactly one
# shape: adding execute permission (755 / +x forms) to .sh/.mjs files
# inside this repo, optionally chained with `bash -n` (parse-only, never
# executes) and echo. Builders authoring scripts need both constantly.
if printf '%s' "$cmd" | grep -qE '(^|[^[:alnum:]_./-])chmod[[:space:]]'; then
  _ch_ok=1
  while IFS= read -r _cc; do
    printf '%s' "$_cc" | grep -qE '^chmod[[:space:]]+(755|\+x|u\+x|a\+x)[[:space:]]+('"$ROOT_RE"'/[^[:space:]]+\.(sh|mjs)[[:space:]]*)+$' || _ch_ok=0
  done <<EOF
$(printf '%s' "$cmd" | grep -oE 'chmod[[:space:]]+[^;&|]+')
EOF
  if [ "$_ch_ok" = 1 ] \
     && ! printf '%s' "$cmd" | tr ';' '\n' | tr '&' '\n' | grep -vE '^[[:space:]]*$' | grep -vE '^[[:space:]]*(chmod[[:space:]]|bash -n[[:space:]]|echo[[:space:]]|shellcheck[[:space:]])' | grep -q .; then
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"chmod +x on repo scripts, with optional bash -n syntax check"}}'
    exit 0
  fi
fi

# ── 0e2. psql inside the local harness container via docker exec ───────
# `docker exec [-i] dbp-postgres-<name> psql …` — SQL against a local
# test container (the shared harness or a throwaway). Writes are the
# harness's purpose; recovery is bootstrap.sh. Only the container-name
# prefix and the psql-immediately-after shape are trusted; any other
# exec'd binary still prompts.
if printf '%s' "$cmd" | grep -qE '(^|[^[:alnum:]_./-])docker[[:space:]]+exec[[:space:]]+(-[a-zA-Z]+[[:space:]]+)*dbp-postgres-[a-z0-9-]*[[:space:]]+psql([^[:alnum:]_-]|$)'; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"psql via docker exec into a local dbp-postgres-* test container"}}'
  exit 0
fi

# ── 0f. aws s3 cp/sync DOWNLOAD-ONLY (s3:// source → local tmp dest) ───
# Log-pull idiom (ALB logs first). Source must be s3://, destination
# must be under tmp — an upload, delete, or bucket-to-bucket copy never
# matches. --delete refused outright.
if printf '%s' "$cmd" | grep -qE '(^|[^[:alnum:]_./-])aws[[:space:]]+s3[[:space:]]+(cp|sync)[[:space:]]' \
   && ! printf '%s' "$cmd" | grep -qE -- '--delete' \
   && printf '%s' "$cmd" | grep -qE 'aws[[:space:]]+s3[[:space:]]+(cp|sync)[[:space:]]+"?s3://[^[:space:]"]+"?[[:space:]]+"?/(private/)?tmp/'; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"aws s3 download-only: s3:// source to a tmp destination"}}'
  exit 0
fi

# ── 0g. Sentry sweep script, test form: state file pinned to tmp ───────
# The sanctioned monitor sweep (read-only Sentry GETs) invoked with its
# state-file override pointing into tmp — the development/test shape.
# The production form (`sh scripts/monitor/sentry-sweep.sh`, no env
# prefix) is covered by the settings allowlist.
if printf '%s' "$cmd" | grep -qE '^[[:space:]]*(time[[:space:]]+)?(SENTRY_MONITOR_STATE_FILE=/(private/)?tmp/[^[:space:]]+[[:space:]]+)?(time[[:space:]]+)?sh[[:space:]]+('"$ROOT_RE"'/)?scripts/monitor/sentry-sweep\.sh[[:space:]]*(;[[:space:]]*echo[[:space:]]+"(EXIT=|exit code: )\$\?")?[[:space:]]*$' \
   && ! printf '%s' "$cmd" | grep -vE '^[[:space:]]*$' | grep -vE '^[[:space:]]*rm -f /(private/)?tmp/[^[:space:]]+[[:space:]]*$' | grep -vE 'sentry-sweep\.sh[[:space:]]*(;[[:space:]]*echo[[:space:]]+"(EXIT=|exit code: )\$\?")?[[:space:]]*$' | grep -q . \
   && ! printf '%s' "$cmd" | grep -oE 'SENTRY_MONITOR_STATE_FILE=[^[:space:]]+' | grep -qvE '=/(private/)?tmp/'; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"sanctioned sentry sweep (state file pinned to tmp when overridden)"}}'
  exit 0
fi

# ── 1. Hard-deny scan — any of these anywhere ⇒ do nothing (prompt) ────
# The scan MUST be quote-aware: a `>` / `<` / `;` / the word `sudo` /
# `git push` etc. inside a quoted argument (e.g. awk `'$1>624 && $1<719'`,
# `grep "sudo" auth.js`) is a literal, NOT a shell token, and must not
# trip these denies. Build two skeletons in one pass:
#   ops  — single AND double quoted spans + escaped chars blanked. Used for
#          redirect / process-sub / dangerous-cmd / git-verb / sed-i / find
#          detection (a real one of those is never quoted — it executes).
#   csub — only single-quoted + escaped blanked, double-quoted KEPT, because
#          `"$(...)"` / "`...`" still expand inside double quotes.
if command -v python3 >/dev/null 2>&1; then
  # `ops`/`csub` come from the shared tokenizer (_shellscan.py). Newlines
  # → spaces here to preserve this hook's historical single-line grep
  # behavior; block-bad-shell consumes the newline-preserving form.
  scan=$(python3 "$SHELLSCAN" ops "$cmd" | tr '\n' ' ')
  scan_csub=$(python3 "$SHELLSCAN" csub "$cmd" | tr '\n' ' ')
else
  # No python3: degrade to the prior raw-string behavior (never worse).
  scan=$cmd
  scan_csub=$cmd
fi

# Strip redirections to /dev/null and fd-dup/-close (e.g. `> /dev/null`,
# `2>/dev/null`, `&> /dev/null`, `>> /dev/null`, `2>&1`, `>&2`, `2>&-`) —
# discarding/duplicating fds is the canonical silence idiom and must never
# read as a write-to-a-real-file. Regex covers the SPACE-separated forms.
scan=$(printf '%s' "$scan" | sed -E 's@[0-9]*&?>>?[[:space:]]*/dev/null@ @g; s@[0-9]*>&[0-9-]+@ @g')
# Neutralize the blessed env-load idiom `source <path>.env` / `. <path>.env`
# for the dangerous-cmd deny only — sourcing the project's own .env is the
# settings.json-allowlisted pattern (KEY=VALUE config, not a script).
# `source script.sh` / `. ~/.bashrc` are untouched ⇒ still prompt. The
# per-segment `source`/`.` block re-checks the .env restriction.
scan=$(printf '%s' "$scan" | sed -E 's@(^|[^[:alnum:]_./-])(source|\.)[[:space:]]+[^[:space:];|&()]*\.env[^[:space:];|&()]*([[:space:]]|$)@ @g')

# Process substitution ⇒ always prompt (inner command unadjudicated).
if printf '%s' "$scan" | grep -qE '>\(|<\('; then
  exit 0
fi

# ── `$VAR` targets: is VAR REALLY assigned a tmp path? ─────────────────
# Three grants (redirect target, `rm $VAR`, `tar -C $VAR`) trust a $VAR
# only when the SAME command assigns it a tmp path. That test used to
# grep the raw command for `(^|[[:space:];])VAR=/tmp/`, which cannot tell
# a shell assignment from the same characters sitting in another
# program's source: `python3 -c "<nl>D=/tmp/junk<nl>" ; rm $D` matched on
# the line boundary and deleted whatever $D held in the real environment
# (measured 2026-09-04, same root cause as the segment fix below — a
# newline inside quotes is DATA, not structure).
# An assignment is only an assignment in COMMAND POSITION, so ask the
# tokenizer: each segment flattened to one line, the assignment anchored
# at its start (after `export` and any earlier VAR=… prefixes). Fails
# CLOSED — no python3, no segments, no grant.
_SEG_FLAT=""
_assigned_tmp() {
  if [ -z "$_SEG_FLAT" ]; then
    command -v python3 >/dev/null 2>&1 || return 1
    _SEG_FLAT=$(python3 "$SHELLSCAN" segs "$cmd" | tr '\n' ' ' | tr '\0' '\n')
    [ -n "$_SEG_FLAT" ] || return 1
  fi
  printf '%s\n' "$_SEG_FLAT" \
    | grep -qE "^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*${1}=[\"']?/(private/)?tmp/"
}

# Real-file output redirects (`>` / `>>`): auto-approve ONLY when every
# target is under /tmp or /private/tmp — the sanctioned scratch space
# (mirrors the rm-only-/tmp rule; pipeline-output capture has no Write-tool
# alternative). Any non-/tmp target, a `..` traversal, or a `>` with no
# cleanly parseable target ⇒ prompt. (`>&fd` / `>/dev/null` already
# stripped from $scan above; quoted `>` already blanked in the skeleton.)
if printf '%s' "$scan" | grep -qE '>>?[[:space:]]*[^|&]'; then
  # Targets come from the RAW command: the sanitized scan blanks quoted
  # spans, so a quoted target like "$SCRATCH/out.json" would vanish and
  # fail closed. A quoted literal `>` in the raw command can only add a
  # bogus target that fails the checks below — a prompt, never an allow.
  _redir_targets=$(printf '%s' "$cmd" | grep -oE '>>?[[:space:]]*"?[^[:space:]|&;<>()"]+' | sed -E 's/^>>?[[:space:]]*"?//' || true)
  [ -z "$_redir_targets" ] && exit 0
  # A RELATIVE redirect target is acceptable ONLY when the command's cd
  # targets put the cwd under tmp (e.g. `cd <scratchpad> && zcat *.gz >
  # combined.log`) — every cd in the command must be a tmp path, and the
  # relative target must not traverse (`..`) or be absolute-disguised.
  _cwd_tmp=0
  _cds=$(printf '%s' "$scan" | grep -oE '(^|[;&|][[:space:]]*)cd[[:space:]]+"?[^[:space:];|&"]+' | sed -E 's/.*cd[[:space:]]+"?//' || true)
  if [ -n "$_cds" ] && ! printf '%s\n' "$_cds" | grep -qvE '^/(private/)?tmp/'; then _cwd_tmp=1; fi
  while IFS= read -r _t; do
    [ -z "$_t" ] && continue
    _t="${_t#\"}"
    case "$_t" in
      *..*) exit 0 ;;
      /tmp/*|/private/tmp/*) : ;;
      \$*)
        # Redirect into "$VAR/..." — trusted only when the SAME command
        # assigns VAR to a tmp path (same rule as cd/tar/rm above).
        _tv=$(printf '%s' "$_t" | sed -E 's/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?.*/\1/')
        _assigned_tmp "$_tv" || exit 0 ;;
      /*) exit 0 ;;
      *) [ "$_cwd_tmp" = 1 ] || exit 0 ;;
    esac
  done <<EOF
$_redir_targets
EOF
fi

# Command substitution — inner command is unadjudicated (project style
# guide also forbids it). Always prompt.
if printf '%s' "$scan_csub" | grep -qE '\$\(|`'; then
  exit 0
fi

# curl/wget piped straight into an interpreter.
if printf '%s' "$scan" | grep -qE '(curl|wget)([^|]*)\|[[:space:]]*(sudo[[:space:]]+)?(sh|bash|zsh|ksh|fish|python3?|node|perl|ruby|php)([[:space:]]|$)'; then
  exit 0
fi

# rsync: the ONE safe shape — a WHOLE command, on its own, copying repo
# files into the scratchpad (2026-09-03/04, seen twice: a doctoring corpus
# and a plan-tree snapshot). rsync sits in the dangerous list below beside
# ssh/scp/sftp because it can exfiltrate, and that list matches the token
# ANYWHERE rather than only in first position — a property worth keeping,
# since `xargs rsync` and friends must never slip through. So rather than
# removing rsync from the list, this computes whether THIS command is the
# safe shape and drops it from the alternation only then.
#
# Safe means all of: the command is a single rsync invocation and nothing
# else (no ;, |, &, redirect, and rsync appears once); no --delete* (it
# removes files — "never re-add --delete" is standing doctrine), no
# --rsh/-e, no rsync:// and no host:path token (that is transfer, not a
# copy); no `..`; every SOURCE is repo-absolute or repo-relative; and the
# DESTINATION is under /tmp or /private/tmp. Anything else still prompts.
_rsync_ok=0
case "$scan" in
  rsync\ *)
    _rsync_ok=1
    case "$scan" in
      *';'*|*'|'*|*'&'*|*'<'*|*'>'*|*--delete*|*--rsh*|*rsync://*|*..*|*' -e '*) _rsync_ok=0 ;;
    esac
    if [ "$_rsync_ok" = 1 ]; then
      _rs_seen=0
      _rs_prev=""
      _rs_last=""
      for tok in $scan; do
        case "$tok" in
          rsync) _rs_seen=$((_rs_seen + 1)); continue ;;
          -*) continue ;;
          *:*) _rsync_ok=0 ;;
        esac
        if [ -n "$_rs_last" ]; then
          _rs_prev="$_rs_last"
          case "$_rs_prev" in
            "$ROOT"/*) : ;;
            /*) _rsync_ok=0 ;;
            *) : ;;
          esac
        fi
        _rs_last="$tok"
      done
      [ "$_rs_seen" -eq 1 ] || _rsync_ok=0
      case "$_rs_last" in
        /tmp/*|/private/tmp/*) : ;;
        *) _rsync_ok=0 ;;
      esac
      [ -n "$_rs_prev" ] || _rsync_ok=0
    fi
    ;;
esac
_rs_alt='rsync|'
if [ "$_rsync_ok" = 1 ]; then _rs_alt=''; fi

# Genuinely dangerous / not-on-allowlist commands anywhere ⇒ prompt.
if printf '%s' "$scan" | grep -qE '(^|[^[:alnum:]_./-])(sudo|su|killall|shutdown|reboot|halt|poweroff|dd|shred|mkfs[a-z.]*|fdisk|parted|mkswap|chmod|chown|chgrp|mount|umount|eval|source|brew|apt|apt-get|yum|dnf|pacman|docker-compose|kubectl|helm|gcloud|az|ssh|scp|sftp|'"$_rs_alt"'mysql|mongo|mongosh|redis-cli)([^[:alnum:]_-]|$)'; then
  exit 0
fi

# docker — carved out of the deny above, but still position-independent:
# the check covers ARGUMENT position too (`xargs docker rm` must prompt —
# xargs is an allowlisted leader, so the per-segment loop never
# adjudicates its arguments). Every `docker …` occurrence in the
# skeleton must parse as a read-only inspect verb (or read group +
# sub-verb); bare `docker`, pre-verb global flags (--context, -H), or
# any unknown/mutating verb ⇒ prompt. This is the single docker
# authority — the per-segment docker block below defers to it.
# (`docker-compose` v1 stays fully denied above; `docker compose` fails
# the verb list here.)
if printf '%s' "$scan" | grep -qE '(^|[^[:alnum:]_./-])docker([^[:alnum:]_-]|$)'; then
  _dscan=$(printf '%s' "$scan" | tr ';|&()<>' '       ')
  _dbad=0
  while IFS= read -r _dp; do
    [ -z "$_dp" ] && continue
    set -- $_dp
    case "$2" in
      info|version|--version|ps|images|inspect|logs|history|port|top|diff|search|stats|events) : ;;
      container|image|volume|network|context|system|builder|buildx)
        case "$3" in
          ls|list|inspect|df|ps|logs|history|top|port|diff|stats|events|show|version|du) : ;;
          *) _dbad=1 ;;
        esac ;;
      *) _dbad=1 ;;
    esac
  done <<EOF
$(printf '%s' "$_dscan" | grep -oE '(^|[[:space:]])docker([[:space:]]+[[:alnum:]-]+){0,2}([[:space:]]|$)')
EOF
  [ "$_dbad" -ne 0 ] && exit 0
fi

# Mutating git verbs anywhere ⇒ prompt. add/commit/fetch/checkout/branch/
# restore/rm/mv/tag/remote and the read verbs are adjudicated per-segment
# below; every other (push/reset/clean/rebase/merge/…) hard-prompts here.
# cherry-pick/revert leave this blanket ONLY when the command is provably
# confined to the agent's own worktree (_wt_ok, computed above). Every
# other mutating verb prompts regardless of tree.
_seq_alt='cherry-pick|revert|'
if [ "$_wt_ok" = 1 ]; then _seq_alt=''; fi
if printf '%s' "$scan" | grep -qE '(^|[^[:alnum:]_-])git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?(push|reset|clean|apply|am|rebase|merge|'"$_seq_alt"'init|clone|config|submodule|worktree[[:space:]]+(add|remove|move|lock|unlock|prune|repair)|update-ref|gc|prune|filter-branch|filter-repo|notes|replace|bisect|format-patch|send-email|request-pull|daemon|svn|p4)([^[:alnum:]_-]|$)'; then
  exit 0
fi
# Bare `git stash` or a MUTATING stash verb ⇒ prompt. `stash list` /
# `stash show` are read-only and must NOT match here — they were
# previously listed as a matching alternative, which wrongly prompted the
# common `git stash list` pre-staging check. Anything that is `git stash`
# but not list/show is still caught per-segment (git block: `*) exit 0`).
if printf '%s' "$scan" | grep -qE '(^|[^[:alnum:]_-])git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?stash([[:space:]]*$|[[:space:]]+(push|pop|apply|drop|clear|create|store|branch|save))'; then
  exit 0
fi

if printf '%s' "$scan" | grep -qE '(^|[^[:alnum:]_-])sed[[:space:]]+(-[a-zA-Z]*i|--in-place)'; then
  exit 0
fi
# sysctl: READ forms only (2026-09-03). `-w`, `--write` and a bare
# `name=value` assignment SET kernel parameters — those keep prompting.
if printf '%s' "$scan" | grep -qE '(^|[^[:alnum:]_-])sysctl([[:space:]]+-[a-zA-Z]*w([[:space:]]|$)|[[:space:]]+--write|[[:space:]]+[a-zA-Z0-9_.]+=)'; then
  exit 0
fi
# find: always-destructive primaries ⇒ prompt globally. `-exec`/`-execdir`
# is adjudicated per-segment below (allowed only when the invoked command
# is a read-only inspector — `find … -exec grep -l … {} \;`).
if printf '%s' "$scan" | grep -qE '(^|[^[:alnum:]_-])find[[:space:]].*(-delete|-okdir|-ok|-fprint|-fprintf|-fls)([^[:alnum:]_-]|$)'; then
  exit 0
fi

# ── 2. Per-segment leading-command allowlist ──────────────────────────
# Segments come from the shared tokenizer (_shellscan.py): quote-/escape-/
# heredoc-aware split on && || ; | <newline>, emitting ORIGINAL segment
# text (NUL-joined) so every per-segment check below runs on real text.
SEG_TMP=$(mktemp "${TMPDIR:-/tmp}/asc.XXXXXX")
trap 'rm -f "$SEG_TMP"' EXIT
if command -v python3 >/dev/null 2>&1; then
  python3 "$SHELLSCAN" segs "$cmd" >"$SEG_TMP"
else
  # Degrade to the legacy blind split if python3 is unavailable — never
  # worse than the prior behavior, just not quote-aware.
  norm=$cmd
  norm=${norm//&&/$'\n'}
  norm=${norm//\|\|/$'\n'}
  norm=${norm//;/$'\n'}
  norm=${norm//|/$'\n'}
  printf '%s' "$norm" | tr '\n' '\0' >"$SEG_TMP"
fi

# Read-only / inspect tools — safe as a segment leader anywhere.
READONLY_CMDS='grep|egrep|fgrep|rg|ag|wc|ls|ll|cat|bat|head|tail|find|awk|jq|yq|sort|uniq|cut|tr|column|nl|paste|comm|join|fold|rev|tac|xxd|od|strings|echo|printf|true|false|test|pwd|date|dirname|basename|realpath|readlink|stat|file|which|type|env|printenv|tree|diff|sed|cd|pushd|popd|set|export|seq|sleep|hexdump|zcat|gzcat|dig|nslookup|host|yes|vm_stat|uptime|uname|sw_vers|df|du|nproc|sysctl|shellcheck|actionlint'

# Mutating/effectful commands that ARE on the static allowlist
# (settings.json + settings.local.json) and are therefore fine as a
# segment leader. Keep in sync with those files.
ALLOWED_CMDS='pnpm|npx|node|bun|bunx|tsx|tsc|python3|make|curl|kill|lsof|ps|mkdir|touch|mv|cp|base64|shasum|md5'

while IFS= read -r -d '' seg || [ -n "$seg" ]; do
  # A newline that SURVIVES segmentation is never shell structure: the
  # tokenizer splits on `&& || ; | <newline>` in NORMAL state only, so a
  # newline still inside a segment sits in a quoted string, a heredoc
  # body, or a `\`-continuation. It is DATA. Every matcher below is a
  # LINE-based grep, so leaving those newlines in place lets an INTERIOR
  # line impersonate the start of the command — and it broke BOTH ways
  # (both measured 2026-09-04):
  #   * false PROMPT — `python3 -c "<nl>import json<nl>base='…'<nl>…"`
  #     hit the `^VAR=` peel below on its interior `base=` line, which ate
  #     the leader word by word until it was unrecognisable. The same
  #     script on ONE line auto-approved, so a shape already sanctioned
  #     was unreachable by FORM alone.
  #   * false ALLOW — a segment with an interior line reading
  #     `bash -n <the project root>/x.sh` matched the parse-
  #     check GRANT below (`^(bash|sh|zsh)[[:space:]]+-n…$`, anchored per
  #     LINE), auto-approving the arbitrary shell wrapped around it. Same
  #     hole in the repo-script, direct-exec, `perl -c` and `command -v`
  #     grants: `/usr/local/bin/whatever --run "<nl>rm -rf …<nl>scripts/
  #     rebase.sh<nl>"` was allowed outright.
  # Collapsing them to spaces makes `^`/`$` mean the start and end of the
  # COMMAND. Deny checks are unaffected — they match
  # `(^|[[:space:]])…([[:space:]]|$)`, and a line boundary becomes a space
  # boundary — so this can only tighten, never loosen.
  seg=${seg//$'\r'/ }
  seg=${seg//$'\n'/ }
  seg="${seg#"${seg%%[![:space:]]*}"}"
  seg="${seg%"${seg##*[![:space:]]}"}"
  [ -z "$seg" ] && continue

  # Peel leading subshell parens even when GLUED to the command
  # (`(cat …`, `((ls …`). The control-flow loop below only handles the
  # space-separated `( ` form, so a glued `(` would otherwise become the
  # leader (`(cat`) and wrongly fall through to a prompt. `$(`/`<(`/`>(`
  # were already hard-denied above, so a leading `(` here is a real
  # subshell group and safe to drop.
  while :; do
    case "$seg" in
      '('*) seg="${seg#?}"; seg="${seg#"${seg%%[![:space:]]*}"}" ;;
      *) break ;;
    esac
    [ -z "$seg" ] && break
  done
  [ -z "$seg" ] && continue

  # Strip trailing subshell-close / terminators glued to the segment
  # (`git status)`, `(ls)`, `cmd;`) so leader AND sub-command parsing
  # below aren't fooled. An unquoted trailing `)`/`}`/`;` is always shell
  # punctuation (a literal would be quoted ⇒ blanked in the skeleton).
  while case "$seg" in *')'|*'}'|*';'|*[[:space:]]) true ;; *) false ;; esac; do
    seg="${seg%?}"
  done
  [ -z "$seg" ] && continue

  # Peel shell control-flow keywords / grouping.
  while :; do
    case "$seg" in
      'for '*|'select '*|'case '*) seg=""; break ;;
      'if '*|'then '*|'elif '*|'else '*|'do '*|'while '*|'until '*|'time '*|'! '*|'{ '*|'( '*)
        seg="${seg#* }"; seg="${seg#"${seg%%[![:space:]]*}"}" ;;
      'fi'|'fi '*|'done'|'done '*|'esac'|'esac '*|'else'|'then'|'}'|')'|'{'|'('|'!')
        seg="${seg#* }"
        case "$seg" in fi|done|esac|else|then|'}'|')'|'{'|'(' ) seg="";; esac ;;
      *) break ;;
    esac
    seg="${seg#"${seg%%[![:space:]]*}"}"
    [ -z "$seg" ] && break
  done
  [ -z "$seg" ] && continue

  # ── curl: an UPLOAD from a local file is not a read (2026-09-04) ────
  # Found by the prod-credential routes audit. `curl` is an allowlisted
  # LEADER, so `curl -X POST -d @/…/.env https://…` auto-approved: one
  # unprompted call that puts any readable file on someone else's
  # server. Reading a file and sending it off the machine are different
  # acts; nothing in this repo uploads a local file, and the allowlist
  # was never meant to cover exfiltration.
  #
  # Checked HERE — before the leader is parsed — so `xargs curl …`,
  # `env curl …` and `pnpm exec curl …` are covered by one rule instead
  # of three copies of it, and so a future grant cannot reach curl
  # without passing this first.
  #
  # Scoped to the flags that actually READ a path: an `@`-prefixed data
  # value (curl treats `@` as a file only when it LEADS the value, so an
  # email address inside a payload is untouched), -T/--upload-file, and
  # -K/--config (a config file can carry its own `data=@…`). `@-` is
  # stdin and /tmp is the sanctioned scratch area — both mirror the `>`
  # redirect and `tee` rules. Fails CLOSED: an @-form or -T target that
  # does not resolve to /tmp prompts, as does a dangling `-d`/`-T`.
  case "$seg" in
    curl|curl' '*|*[[:space:]]curl|*[[:space:]]curl' '*|*/curl|*/curl' '*)
      _cu_bad=0
      _cu_next=""
      for tok in $seg; do
        tok=${tok//\"/}
        tok=${tok//\'/}
        if [ "$_cu_next" = "path" ]; then
          _cu_next=""
          case "$tok" in
            -|/tmp/*|/private/tmp/*) : ;;
            *) _cu_bad=1 ;;
          esac
          continue
        fi
        if [ "$_cu_next" = "data" ]; then
          _cu_next=""
          case "$tok" in
            @-|@/tmp/*|@/private/tmp/*) : ;;
            @*) _cu_bad=1 ;;
            *=@-|*=@/tmp/*|*=@/private/tmp/*) : ;;
            *=@*) _cu_bad=1 ;;
          esac
          continue
        fi
        case "$tok" in
          -T|--upload-file) _cu_next="path" ;;
          -T-|-T/tmp/*|-T/private/tmp/*) : ;;
          -T?*) _cu_bad=1 ;;
          --upload-file=-|--upload-file=/tmp/*|--upload-file=/private/tmp/*) : ;;
          --upload-file=*) _cu_bad=1 ;;
          -K|-K?*|--config|--config=*) _cu_bad=1 ;;
          -d|--data|--data-binary|--data-ascii|--data-urlencode|-F|--form) _cu_next="data" ;;
          -d@-|-d@/tmp/*|-d@/private/tmp/*) : ;;
          -d@*) _cu_bad=1 ;;
          --data=@-|--data=@/tmp/*|--data=@/private/tmp/*) : ;;
          --data=@*) _cu_bad=1 ;;
          --data-binary=@-|--data-binary=@/tmp/*|--data-binary=@/private/tmp/*) : ;;
          --data-binary=@*) _cu_bad=1 ;;
          --data-ascii=@-|--data-ascii=@/tmp/*|--data-ascii=@/private/tmp/*) : ;;
          --data-ascii=@*) _cu_bad=1 ;;
          --data-urlencode=@-|--data-urlencode=@/tmp/*|--data-urlencode=@/private/tmp/*) : ;;
          --data-urlencode=@*) _cu_bad=1 ;;
          --form=*=@/tmp/*|--form=*=@/private/tmp/*) : ;;
          --form=*=@*) _cu_bad=1 ;;
        esac
      done
      [ -n "$_cu_next" ] && _cu_bad=1
      [ "$_cu_bad" -eq 1 ] && exit 0 ;;
  esac

  # Peel leading VAR=value assignments (PID=$!, FOO=bar cmd, …) — but an
  # interpreter/loader-hijack variable makes the WHOLE command prompt
  # (added 2026-08-30): PATH/IFS/LD_*/DYLD_*/NODE_OPTIONS/GIT_DIR-class
  # assignments change WHAT an otherwise-allowlisted leader executes, so
  # peeling them silently would launder arbitrary code through a trusted
  # command name. DB-pointing vars are already gated by the wrong-target
  # tripwire (§0b2), which runs before segmentation.
  while [ -n "$seg" ] && printf '%s' "$seg" | grep -qE '^[A-Za-z_][A-Za-z0-9_]*='; do
    _as_name="${seg%%=*}"
    case "$_as_name" in
      PATH|IFS|ENV|BASH_ENV|SHELLOPTS|PS4|CDPATH|SHELL|EDITOR|PAGER|TMPDIR|LD_*|DYLD_*|NODE_OPTIONS|NODE_PATH|NODE_REPL*|PYTHON*|PERL5*|RUBYOPT|RUBYLIB|GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_SSH*|GIT_PAGER|GIT_EDITOR|GIT_CONFIG*|GIT_EXEC_PATH|PNPM_HOME|NPM_CONFIG_*|npm_config_*)
        exit 0 ;;
    esac
    case "$seg" in
      *' '*) seg="${seg#* }"; seg="${seg#"${seg%%[![:space:]]*}"}" ;;
      *) seg="" ;;
    esac
  done
  [ -z "$seg" ] && continue

  # `timeout [flags] <duration> cmd …` wraps a command without changing
  # what it does — peel the wrapper and adjudicate the wrapped command
  # (added 2026-08-30; `cd x && BRAND=dbp timeout 180 pnpm build` was a
  # measured prompt shape). Runs AFTER the VAR= peel deliberately, so an
  # env-prefixed timeout still resolves to its real leader.
  while :; do
    case "$seg" in
      'timeout '*)
        seg="${seg#* }"; seg="${seg#"${seg%%[![:space:]]*}"}"
        while :; do
          case "$seg" in
            '-k '*|'--kill-after '*|'-s '*|'--signal '*)
              seg="${seg#* }"; seg="${seg#"${seg%%[![:space:]]*}"}"
              seg="${seg#* }"; seg="${seg#"${seg%%[![:space:]]*}"}" ;;
            '--preserve-status '*|'--foreground '*|'-v '*|'--verbose '*)
              seg="${seg#* }"; seg="${seg#"${seg%%[![:space:]]*}"}" ;;
            *) break ;;
          esac
        done
        case "${seg%%[[:space:]]*}" in
          [0-9]*) case "$seg" in *' '*) seg="${seg#* }"; seg="${seg#"${seg%%[![:space:]]*}"}" ;; *) seg="" ;; esac ;;
        esac ;;
      *) break ;;
    esac
    [ -z "$seg" ] && break
  done
  [ -z "$seg" ] && continue

  case "$seg" in '['*|'[['*) continue ;; esac

  first="${seg%%[[:space:]]*}"
  # Normalize an absolute/relative path leader to its basename so
  # `/usr/bin/grep`, `/bin/cat`, `/usr/bin/git` (used by Claude Code's own
  # tooling and many agents) match the same rules as the bare command.
  # `./script.sh` → `script.sh` (still unknown ⇒ still prompts: correct).
  case "$first" in */*) first="${first##*/}" ;; esac

  # ── git: read verbs + the allowlisted mutators ──────────────────────
  if [ "$first" = "git" ]; then
    rest="${seg#git}"
    rest="${rest#"${rest%%[![:space:]]*}"}"
    while :; do
      case "$rest" in
        -C\ *|-c\ *)
          rest="${rest#* }"; rest="${rest#"${rest%%[![:space:]]*}"}"
          rest="${rest#* }"; rest="${rest#"${rest%%[![:space:]]*}"}" ;;
        *) break ;;
      esac
    done
    sub="${rest%%[[:space:]]*}"
    case "$sub" in
      commit|fetch|branch|tag|remote|status|log|diff|show|blame|ls-files|ls-tree|rev-parse|rev-list|describe|shortlog|reflog|diff-tree|cat-file|for-each-ref|name-rev|whatchanged|grep|var|symbolic-ref|check-ignore|check-attr|merge-base|verify-commit|verify-tag|count-objects|ls-remote|archive|patch-id|cherry|range-diff)
        continue ;;
      add)
        # Pathspec adds only (shared-index guard, 2026-08-30): `-A`,
        # `--all`, and a bare `.` sweep other agents' work into the
        # index (CLAUDE.local.md: "Stage only your task's files").
        # Settings deny the simple forms; compounds prompt here.
        printf '%s' "$seg" | grep -qE '(^|[[:space:]])(-A|--all|\.)([[:space:]]|$)' && exit 0
        continue ;;
      checkout|restore|rm|mv|pull)
        # Banned or settings-denied verbs (git-safety sync 2026-08-30):
        # checkout/pull/rm are CLAUDE.local.md bans (rm/mv also stage
        # instantly in a shared index); restore discards working-tree
        # state. Never hook-allow these — the settings deny is
        # authoritative.
        exit 0 ;;
      cherry-pick|revert)
        # Worktree-confined replay only (2026-09-03). `cherry` above is a
        # different, read-only verb — the case patterns are exact, so
        # `cherry-pick` never rides in on it.
        if [ "$_wt_ok" = 1 ]; then continue; fi
        exit 0 ;;
      worktree)
        # Only `list` is read-only (punch8-w4-review, 2026-09-02) —
        # Amendment #2 blocks add/remove/move/lock/unlock/prune/repair;
        # those go through scripts/worktree-*.mjs only.
        nxt="${rest#worktree}"; nxt="${nxt#"${nxt%%[![:space:]]*}"}"; nxt="${nxt%%[[:space:]]*}"
        case "$nxt" in list) continue ;; *) exit 0 ;; esac ;;
      stash)
        nxt="${rest#stash}"; nxt="${nxt#"${nxt%%[![:space:]]*}"}"; nxt="${nxt%%[[:space:]]*}"
        case "$nxt" in list|show) continue ;; *) exit 0 ;; esac ;;
      *) exit 0 ;;
    esac
  fi

  # ── aws: read-only verbs only (mirrors settings.json) ───────────────
  if [ "$first" = "aws" ]; then
    if printf '%s' "$seg" | grep -qE '(^|[[:space:]])(get-secret-value|get-parameters?|get-parameter-history|kms[[:space:]]+decrypt|sts[[:space:]]+(assume-role|assume-role-with-[a-z-]+|get-session-token|get-federation-token)|ecr[[:space:]]+get-login-password|signer[[:space:]]+get-)([[:space:]]|$)'; then exit 0; fi
    if printf '%s' "$seg" | grep -qE '(^|[[:space:]])(s3[[:space:]]+(cp|mv|rm|sync|mb|rb)|create-[a-z0-9-]+|delete-[a-z0-9-]+|put-[a-z0-9-]+|update-[a-z0-9-]+|modify-[a-z0-9-]+|terminate-[a-z0-9-]+|reboot-[a-z0-9-]+|run-instances|start-instances|stop-instances|stop-query|attach-[a-z0-9-]+|detach-[a-z0-9-]+|associate-[a-z0-9-]+|disassociate-[a-z0-9-]+|authorize-[a-z0-9-]+|revoke-[a-z0-9-]+|register-[a-z0-9-]+|deregister-[a-z0-9-]+|enable-[a-z0-9-]+|disable-[a-z0-9-]+|cancel-[a-z0-9-]+|reset-[a-z0-9-]+|set-[a-z0-9-]+|add-[a-z0-9-]+|remove-[a-z0-9-]+|import-[a-z0-9-]+|upload-[a-z0-9-]+|copy-[a-z0-9-]+|restore-[a-z0-9-]+|send-[a-z0-9-]+|tag-resource|untag-resource|publish|invoke|deploy|execute-[a-z0-9-]+)([[:space:]]|$)'; then exit 0; fi
    if printf '%s' "$seg" | grep -qE '(^|[[:space:]])(describe-[a-z0-9-]+|list-[a-z0-9-]+|get-[a-z0-9-]+|lookup-events|filter-log-events|start-query|get-query-results|batch-get-[a-z0-9-]+)([[:space:]]|$)'; then continue; fi
    exit 0
  fi

  # ── command -v/-V: pure lookup; bare `command <cmd>` EXECUTES, so
  # only the flag forms pass ─────────────────────────────────────────
  if [ "$first" = "command" ]; then
    printf '%s' "$seg" | grep -qE '^command[[:space:]]+-[vV][[:space:]]+[A-Za-z0-9_./-]+[[:space:]]*$' && continue
    exit 0
  fi

  # ── psql/pg_dump version checks: read-only, no connection made ──────
  if [ "$first" = "psql" ] || [ "$first" = "pg_dump" ] || [ "$first" = "pg_restore" ]; then
    printf '%s' "$seg" | grep -qE '^(psql|pg_dump|pg_restore)[[:space:]]+(--version|-V)([[:space:]]|$)' && continue
    exit 0
  fi

  # ── rm: tmp targets, repo targets, or cwd-relative targets ──────────
  # Judged per segment so surrounding segments still face their own
  # checks. Mirrors the static rules (`Bash(rm /tmp/*)`, `Bash(rm
  # <the project root>/*)`) plus — added 2026-08-30, measured
  # prompt shape #9 — RELATIVE paths (an agent's cwd is this repo or a
  # worktree of it). Refused always: `..` anywhere, `~` targets, any
  # other absolute root, and anything under a `.git/` dir (index/hook
  # tampering). $VAR targets are trusted only when the SAME command
  # assigns the var to a tmp path.
  if [ "$first" = "rm" ]; then
    case "$seg" in *..*) exit 0 ;; esac
    # Recursive deletes (-r/-R/--recursive) stay tmp-only: `rm -rf` of a
    # repo directory is a whole-tree wipe and must prompt (mirrors the
    # static rules exactly — only `rm`/`rm -f` cover repo paths).
    _rm_recursive=0
    printf '%s' "$seg" | grep -qE '(^|[[:space:]])(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)([[:space:]]|$)' && _rm_recursive=1
    _rm_seg_ok=1
    for _a in $(printf '%s' "$seg" | sed -E 's/^rm//' | tr ' ' '\n' | sed -E 's/^"|"$//g' | grep -vE '^(-|$)'); do
      case "$_a" in
        .git/*|*/.git/*|.git) _rm_seg_ok=0 ;;
        /tmp/*|/private/tmp/*) : ;;
        "$ROOT"/*) [ "$_rm_recursive" = 1 ] && _rm_seg_ok=0 ;;
        \$*)
          _rv=$(printf '%s' "$_a" | sed -E 's/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?.*/\1/')
          _assigned_tmp "$_rv" || _rm_seg_ok=0 ;;
        \~*) _rm_seg_ok=0 ;;
        /*) _rm_seg_ok=0 ;;
        *) [ "$_rm_recursive" = 1 ] && _rm_seg_ok=0 ;;
      esac
    done
    [ "$_rm_seg_ok" = 1 ] && continue
    exit 0
  fi

  # ── bash/sh: -n parse checks, plus KNOWN repo scripts ───────────────
  # `bash -n <repo|tmp script>` never executes. Beyond that (added
  # 2026-08-30, measured prompt shape #5): `bash|sh` invoking the repo's
  # OWN reviewed tooling — scripts/**.sh, the test-db bootstrap, and
  # (added same day, prepush-gate live run) the repo's real
  # `.git/hooks/pre-push`, which the gate must execute exactly as a push
  # would (stdin refs; runs only checks — no capability an agent lacks).
  # Absolute or repo-relative path. EXCLUDED: `agent-push.sh` (its
  # approval belongs to allow-agent-push.sh — push-agent only),
  # `migrations/**` (owner-run by doctrine), every OTHER `.git/hooks/*`
  # file, and any script outside those trees (a scratchpad script an
  # agent authored itself is arbitrary shell). No `..` in the segment.
  if [ "$first" = "bash" ] || [ "$first" = "sh" ] || [ "$first" = "zsh" ]; then
    printf '%s' "$seg" | grep -qE '^(bash|sh|zsh)[[:space:]]+-n[[:space:]]+('"$ROOT_RE"'|/(private/)?tmp)/[^[:space:]]+[[:space:]]*$' && continue
    case "$seg" in *..*) exit 0 ;; esac
    # web-app/e2e/scripts/**.sh added 2026-09-03: the e2e harness wrappers
    # are strictly NARROWER than what they already call — bootstrap-e2e-db.sh
    # pins dbp_e2e on loopback 54320 and delegates to the test-db
    # bootstrap.sh allowed on the line below, taking care that DB_NAME
    # cannot retarget it.
    if printf '%s' "$seg" | grep -qE '^(bash|sh)[[:space:]]+('"$ROOT_RE"'/)?(scripts/[^[:space:]]+\.sh|web-app/e2e/scripts/[^[:space:]]+\.sh|infrastructure/test-db/bootstrap\.sh|\.git/hooks/pre-push)([[:space:]]|$)' \
       && ! printf '%s' "$seg" | grep -q 'agent-push\.sh'; then
      continue
    fi
    # Same scripts, reached through a worktree path — content-identity
    # grant, see _wt_reviewed_script at the top of this file.
    if _wt_reviewed_script "$(printf '%s' "$seg" | awk '{print $2}')"; then
      continue
    fi
    exit 0
  fi

  # ── Direct execution of the SAME sanctioned scripts (2026-09-03) ────
  # `./infrastructure/test-db/bootstrap.sh` is the natural way to run it
  # and prompted purely on INVOCATION FORM — the absorber above only
  # matches an explicit `bash`/`sh` prefix. Same allowlist, same
  # exclusions: agent-push.sh belongs to allow-agent-push.sh, migrations/**
  # stays owner-run, `..` is refused, and a scratchpad script an agent
  # wrote itself is still arbitrary shell. (bootstrap.sh itself refuses a
  # non-loopback PGHOST and validates TEST_DB_NAME before its DROP
  # DATABASE, so the risk profile is unchanged from the bash form.)
  if printf '%s' "$seg" | grep -qE '^(\./|'"$ROOT_RE"'/)?(scripts/[^[:space:]]+\.sh|web-app/e2e/scripts/[^[:space:]]+\.sh|infrastructure/test-db/bootstrap\.sh)([[:space:]]|$)'; then
    case "$seg" in *..*) exit 0 ;; esac
    if printf '%s' "$seg" | grep -q 'agent-push\.sh'; then exit 0; fi
    continue
  fi
  # Direct-exec form of the same worktree-path scripts (2026-09-05).
  if _wt_reviewed_script "$(printf '%s' "$seg" | awk '{print $1}')"; then
    continue
  fi

  # rsync reaches here only when the whole-command shape check above
  # already passed (repo -> scratchpad, no delete, no remote); otherwise
  # the dangerous-token scan prompted long before this loop.
  if [ "$first" = "rsync" ]; then
    if [ "$_rsync_ok" = 1 ]; then continue; fi
    exit 0
  fi

  # ── perl -c: syntax check of a REPO file only (2026-09-03) ──────────
  # `-c` skips the main body but BEGIN blocks and `use` DO run at compile
  # time, so this is "execute the repo's own code", not a static parse —
  # which is exactly why it is scoped to the repo tree (worktrees
  # included, via the absolute repo root or a repo-relative path). A
  # scratchpad script an agent authored itself is arbitrary code and
  # still prompts. ONLY the bare `-c FILE` shape: -e/-E/-n/-p/-i all
  # execute, and `perl FILE` runs it outright.
  if [ "$first" = "perl" ]; then
    case "$seg" in *..*) exit 0 ;; esac
    if printf '%s' "$seg" | grep -qE '^perl[[:space:]]+-c[[:space:]]+('"$ROOT_RE"'/[^[:space:]]+|[A-Za-z0-9_][^[:space:]/][^[:space:]]*|[A-Za-z0-9_][^[:space:]]*/[^[:space:]]+)[[:space:]]*$'; then
      continue
    fi
    exit 0
  fi

  # ── tar: list anywhere; extract ONLY into /tmp or /private/tmp ──────
  # `git archive <sha> | tar -x -C <scratchpad>` is the gate's clean-
  # snapshot idiom. Extraction writes files, so it is allowed only when
  # a -C target exists and every -C target is under tmp; a bare
  # `tar -x` (extracts into cwd = the repo) still prompts.
  if [ "$first" = "tar" ]; then
    if printf '%s' "$seg" | grep -qE '(^|[[:space:]])(-t[a-z]*|--list)([[:space:]]|$)'; then continue; fi
    _tar_ok=1; _tar_any=0
    for _tc in $(printf '%s' "$seg" | grep -oE -- '-C[[:space:]]+"?[^[:space:]"]+' | sed -E 's/-C[[:space:]]+"?//'); do
      _tar_any=1
      case "$_tc" in
        /tmp/*|/private/tmp/*) : ;;
        \$*)
          # A $VAR target is trusted only if the SAME command assigns it
          # to a tmp path.
          _tv=$(printf '%s' "$_tc" | sed -E 's/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?.*/\1/')
          _assigned_tmp "$_tv" || _tar_ok=0 ;;
        *) _tar_ok=0 ;;
      esac
    done
    [ "$_tar_any" = 1 ] && [ "$_tar_ok" = 1 ] && continue
    exit 0
  fi

  # ── gh: read-only subcommands only ──────────────────────────────────
  if [ "$first" = "gh" ]; then
    # --help output is read-only whatever the subcommand; `gh variable
    # get/list` prints non-secret repo variables (gh has no secret-value
    # reader, so no secret can leak this way).
    if printf '%s' "$seg" | grep -qE -- '(^|[[:space:]])--help([[:space:]]|$)'; then continue; fi
    if printf '%s' "$seg" | grep -qE '^gh[[:space:]]+variable[[:space:]]+(get|list)([[:space:]]|$)'; then continue; fi
    rest="${seg#gh}"; rest="${rest#"${rest%%[![:space:]]*}"}"
    sub="${rest%%[[:space:]]*}"; rest2="${rest#"$sub"}"; rest2="${rest2#"${rest2%%[![:space:]]*}"}"; verb="${rest2%%[[:space:]]*}"
    case "$sub" in
      search|status) continue ;;
      auth) case "$verb" in status|token) continue ;; *) exit 0 ;; esac ;;
      api)
        if printf '%s' "$seg" | grep -qE -- '(-X|--method)[[:space:]]+"?(POST|PUT|PATCH|DELETE)|(^|[[:space:]])(-f|--field|-F|--raw-field|--input)([[:space:]=]|$)'; then exit 0; fi
        continue ;;
      pr|issue|run|workflow|release|repo|cache|label|project|gist|codespace|ssh-key|gpg-key|secret|variable|ruleset|browse)
        case "$verb" in view|list|checks|diff|status|ls|watch) continue ;; *) exit 0 ;; esac ;;
      *) exit 0 ;;
    esac
  fi

  # ── terraform: read/plan verbs only (mirrors settings.json) ─────────
  # The global `-chdir=<dir>` flag precedes the verb and must be peeled
  # first. `plan` never persists state or touches infra (brief state
  # lock + provider read calls only) — it's the standard pre-apply
  # validation gate. Mutating verbs (apply, destroy, import, taint,
  # refresh, init, state mv/rm/push, workspace new/select/delete,
  # force-unlock) fall through to the prompt, as does `test` — it can
  # provision real resources.
  if [ "$first" = "terraform" ] || [ "$first" = "tofu" ]; then
    rest="${seg#"$first"}"
    rest="${rest#"${rest%%[![:space:]]*}"}"
    while :; do
      case "$rest" in
        -chdir=*) rest="${rest#* }"; rest="${rest#"${rest%%[![:space:]]*}"}" ;;
        *) break ;;
      esac
    done
    sub="${rest%%[[:space:]]*}"
    case "$sub" in
      # `console` added 2026-09-03: read-only expression evaluation against
      # config + the already-bound state. It cannot apply, and it is no
      # weaker than `show`/`output`, which dump state outright. Fed from a
      # pipe (`echo 'local.x' | terraform console`) it is one-shot rather
      # than interactive. Whatever backend is bound bounds it — binding a
      # prod key is still a prompt.
      show|output)
        # `-json` prints SENSITIVE values in CLEARTEXT; the human-readable
        # form redacts them (2026-09-04, prod-credential routes audit).
        # The "binding a prod key is still a prompt" reasoning above
        # covers `init` only — NINE roots in this checkout are already
        # bound to prod state from earlier authorized runs, so these two
        # verbs reach prod state with no further binding, and prod state
        # carries the push-notification keys and the Apple Sign-in secret
        # as data-source attributes. `state pull` dumps the same JSON and
        # has always prompted; this closes the gap between them. The
        # readable form stays granted — it IS the resource-level summary
        # doctrine asks agents to hand Timo.
        case "$seg" in *-json*) exit 0 ;; esac
        continue ;;
      plan|validate|graph|version|providers|fmt|console) continue ;;
      init)
        # Two safe init shapes (sync-w2's prompts, 2026-09-02); anything
        # else still prompts, and -migrate-state/-force-copy ALWAYS do —
        # they move state.
        #   1. `init -backend=false` — the validate prerequisite:
        #      providers/modules download locally, no backend touched.
        #   2. `init … -backend-config=key=<…/dev/terraform.tfstate>` —
        #      binding a DEV state key so `plan` can produce the
        #      resource-level summary doctrine requires agents to hand
        #      Timo. Every -backend-config present must be a key= ending
        #      in /dev/terraform.tfstate (prod keys, bucket/region/lock
        #      overrides, and the space-separated form all fall through);
        #      -reconfigure is fine here — it rebinds without migrating.
        case "$seg" in
          *-migrate-state*|*-force-copy*) exit 0 ;;
        esac
        case "$seg" in
          *-backend-config*)
            ok=1
            for tok in $seg; do
              # `-backend-config="key=…"` is the SAME binding as the bare
              # form, and quoting the value is the natural way to write it —
              # but only the unquoted form matched, so the sanctioned dev
              # shape prompted anyway (measured 2026-09-03, build-broadcast-w4).
              # Strip surrounding quotes before deciding; the bound is the
              # KEY, never the quoting.
              tok=${tok//\"/}
              tok=${tok//\'/}
              case "$tok" in
                -backend-config=key=*/dev/terraform.tfstate) : ;;
                -backend-config|-backend-config=*) ok=0 ;;
              esac
            done
            [ "$ok" -eq 1 ] && continue
            exit 0 ;;
          *-backend=false*) continue ;;
          *) exit 0 ;;
        esac ;;
      state|workspace)
        nxt="${rest#"$sub"}"; nxt="${nxt#"${nxt%%[![:space:]]*}"}"; nxt="${nxt%%[[:space:]]*}"
        case "$nxt" in list|show) continue ;; *) exit 0 ;; esac ;;
      *) exit 0 ;;
    esac
  fi

  # ── tee: only writing under /tmp (mirrors the > /tmp redirect rule).
  # `tee` with no file arg is a harmless stdout pass-through. Flags
  # (-a/-i/--append/…) are fine; every path arg must be /tmp, no `..`. ─
  if [ "$first" = "tee" ]; then
    bad=0
    for tok in $seg; do
      case "$tok" in
        tee|-*) : ;;
        *..*) bad=1 ;;
        /tmp/*|/private/tmp/*) : ;;
        *) bad=1 ;;
      esac
    done
    [ "$bad" -eq 0 ] && continue
    exit 0
  fi

  # ── ln: only symbolic (mirrors Bash(ln -s *)) ───────────────────────
  if [ "$first" = "ln" ]; then
    printf '%s' "$seg" | grep -qE '(^|[[:space:]])-s([[:space:]]|[a-zA-Z]*[[:space:]])' && continue
    exit 0
  fi

  # ── find: read-only unless it mutates. Destructive primaries prompt;
  # -exec/-execdir is OK only when the invoked command is a read-only
  # inspector (same token-walk idiom as the rm/tee blocks).
  if [ "$first" = "find" ]; then
    prev=""
    bad=0
    for tok in $seg; do
      case "$prev" in
        -exec|-execdir)
          case "$tok" in
            grep|egrep|fgrep|rg|wc|cat|head|tail|awk|sort|uniq|cut|tr|nl|od|xxd|strings|file|stat|basename|dirname|echo|printf|true) : ;;
            *) bad=1 ;;
          esac ;;
      esac
      case "$tok" in
        -delete|-fprint|-fprintf|-fls|-ok|-okdir) bad=1 ;;
      esac
      prev="$tok"
    done
    [ "$bad" -eq 0 ] && continue
    exit 0
  fi

  # ── source / . : only the project env-load idiom (`source …/.env`).
  # Sourcing a script (.sh, rc files, anything not *.env) executes
  # arbitrary code ⇒ prompt. Mirrors settings.json's allowlisted
  # `set -a && source .env && set +a` pattern.
  if [ "$first" = "source" ] || [ "$first" = "." ]; then
    rest="${seg#"$first"}"
    rest="${rest#"${rest%%[![:space:]]*}"}"
    arg="${rest%%[[:space:]]*}"
    case "$arg" in
      *.env|*.env.*) continue ;;
      *) exit 0 ;;
    esac
  fi

  # ── docker: already vetted by the position-independent gate ─────────
  # The hard-deny area holds the single docker authority: every docker
  # occurrence (leader or argument) was required to be a read-only
  # inspect form, else we'd have prompted before reaching this loop.
  if [ "$first" = "docker" ]; then
    continue
  fi

  # ── gzip / gunzip: stdout + inspect forms only ──────────────────────
  # `-c`/`--stdout` writes to stdout, `-t`/`--test` and `-l`/`--list` only
  # read — all safe. Any other form rewrites the file in place (gunzip
  # deletes the .gz, gzip replaces the original) ⇒ prompt. zcat/gzcat are
  # unconditionally stdout-only and live in READONLY_CMDS.
  if [ "$first" = "gzip" ] || [ "$first" = "gunzip" ]; then
    printf '%s' "$seg" | grep -qE '(^|[[:space:]])-([a-zA-Z0-9]*[ctl][a-zA-Z0-9]*|-stdout|-to-stdout|-test|-list)([[:space:]]|$)' && continue
    exit 0
  fi

  # ── xargs: trusted only as far as the command it spawns ─────────────
  # (static Bash(xargs *) removed 2026-08-30 — xargs EXECUTES its
  # argument, so it inherits the argument's trust, never blanket trust.)
  # Allowed only when the spawned command is a read-only inspector
  # (`git ls-files | xargs grep -l …`); anything else — xargs rm, xargs
  # docker, bare xargs (defaults to echo but proves nothing) — prompts.
  if [ "$first" = "xargs" ]; then
    _xa=""
    for _xt in $(printf '%s' "$seg" | sed -E 's/^xargs//'); do
      case "$_xt" in
        -*|\{\}*) : ;;
        [0-9]*) : ;;
        *) _xa="$_xt"; break ;;
      esac
    done
    [ -z "$_xa" ] && exit 0
    case "$_xa" in */*) _xa="${_xa##*/}" ;; esac
    # READONLY or ALLOWED spawned commands grant nothing xargs-specific —
    # anything here could run directly. rm/docker/sh/etc. still prompt.
    printf '%s' "$_xa" | grep -qE "^(${READONLY_CMDS}|${ALLOWED_CMDS})\$" && continue
    # `xargs git <read-verb>` (2026-08-30, measured live on the first
    # engine day: triage agents' git archaeology — `git log --all -- f |
    # xargs -I{} git log -1 --format=… {}`). git is adjudicated by its
    # own section, not the flat lists, so admit exactly the pure READ
    # verbs here; any mutator via xargs (add/rm/commit/branch/tag/…)
    # still prompts.
    if [ "$_xa" = "git" ]; then
      _xsub=$(printf '%s' "$seg" | awk '{for(i=1;i<=NF;i++){if(f){if($i=="-C"||$i=="-c"){i++;continue} print $i; exit} if($i=="git")f=1}}')
      case "$_xsub" in
        log|show|diff|status|blame|ls-files|ls-tree|rev-parse|rev-list|cat-file|describe|shortlog|grep|merge-base|reflog|name-rev|whatchanged|for-each-ref|count-objects|check-ignore|check-attr|ls-remote)
          continue ;;
      esac
    fi
    exit 0
  fi

  # ── allowlisted effectful commands ──────────────────────────────────
  if printf '%s' "$first" | grep -qE "^(${ALLOWED_CMDS})\$"; then
    continue
  fi

  # ── read-only / inspect commands ────────────────────────────────────
  if printf '%s' "$first" | grep -qE "^(${READONLY_CMDS})\$"; then
    continue
  fi

  # Unknown segment leader ⇒ let the normal permission prompt happen.
  exit 0
done <"$SEG_TMP"

printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"compound command: every segment leads with an allowlisted command (mirrors settings.json + settings.local.json), no hard-deny tokens"}}'
}

# ── 3. Fall-through disposition (2026-08-28) ───────────────────────────
# Historically a non-allowlistable command ended at one of main()'s ~50
# `exit 0` sites: no output, so Claude Code fell back to a PERMISSION
# PROMPT. That is right for a human-attended session and wrong for the
# unwatched orchestration engine, where the prompt lands on Timo for a
# command he never typed. Under the engine we convert the fall-through
# into a deny whose reason IS the rewrite coaching; every other session
# keeps the historical silence.

_HOOK_SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# FALLBACK detector only (2026-08-30): the AUTHORITATIVE signal is now
# the hook payload's own `permission_mode` field, read below — it covers
# every launch spelling (`--permission-mode=dontAsk`, defaultMode from
# settings, env-set modes) that this ps walk structurally cannot see.
# The walk remains only for harness versions whose payload lacks the
# field: true when some ancestor process is a `claude` launched with
# `--permission-mode dontAsk` (either spelling). Walks $PPID upward with
# ps, stopping at pid 1, an unreadable pid, or a ppid that fails to
# advance.
_hook_under_engine() {
  _eng_pid=$PPID
  while : ; do
    case "$_eng_pid" in ''|*[!0-9]*) return 1 ;; esac
    [ "$_eng_pid" -gt 1 ] || return 1
    _eng_line=$(ps -o ppid=,args= -p "$_eng_pid" 2>/dev/null) || _eng_line=""
    [ -n "$_eng_line" ] || return 1
    _eng_line="${_eng_line#"${_eng_line%%[![:space:]]*}"}"
    _eng_ppid="${_eng_line%%[[:space:]]*}"
    _eng_args="${_eng_line#"$_eng_ppid"}"
    case "$_eng_args" in
      *claude*)
        case "$_eng_args" in
          *"--permission-mode dontAsk"*|*"--permission-mode=dontAsk"*) return 0 ;;
        esac ;;
    esac
    [ "$_eng_ppid" = "$_eng_pid" ] && return 1
    _eng_pid="$_eng_ppid"
  done
}

# A hook DENY is TERMINAL in Claude Code: it overrides the static
# permission allowlist and any allow emitted by a sibling hook (see
# tests/adjudicate.py — "any deny blocks; otherwise first allow wins").
# main() deliberately does not mirror every static rule (`sh
# scripts/agent-push.sh`, `docker compose …`, `docker exec …`, `unzip …`,
# the test-db bootstrap), and allow-agent-push.sh grants a shape main()
# falls through on. Denying EVERY fall-through would therefore block work
# that is authorized today — the push-agent's push most of all. So the
# deny fires only for commands no static `Bash(...)` allow rule covers:
# exactly the set that would otherwise have prompted Timo.
# Matching mirrors Claude Code's own rule semantics EXACTLY — a rule is
# an exact string, a `*` glob, or `cmd:*` (= `cmd` alone or `cmd <args>`).
# No bare-prefix arm: the first version tried every rule as a prefix too,
# and `Bash(ps)` then matched `psql …`, skipping the deny and re-creating
# the prompt on the very first command that started with "ps"
# (2026-08-28). Over-matching degrades to a PROMPT on Timo, which is the
# one outcome this block exists to prevent. A missing jq still counts as
# a hit (fail toward the historical behaviour, never toward denying
# authorized work).
_static_allow_hit() {
  _sa_cmd=$1
  [ -n "$_sa_cmd" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  for _sa_f in "$_HOOK_SELF_DIR/../settings.json" "$_HOOK_SELF_DIR/../settings.local.json" "$HOME/.claude/settings.json"; do
    [ -f "$_sa_f" ] || continue
    _sa_rules=$(jq -r '(.permissions.allow // [])[] | select(startswith("Bash(")) | .[5:-1]' "$_sa_f" 2>/dev/null) || _sa_rules=""
    [ -n "$_sa_rules" ] || continue
    while IFS= read -r _sa_rule; do
      [ -n "$_sa_rule" ] || continue
      # `Bash(cmd:*)` is Claude Code's prefix spelling: the bare command,
      # or the command followed by a space and anything — never `cmdfoo`.
      case "$_sa_rule" in
        *:\*)
          _sa_base="${_sa_rule%:\*}"
          case "$_sa_cmd" in "$_sa_base"|"$_sa_base "*) return 0 ;; esac
          continue ;;
      esac
      case "$_sa_cmd" in
        $_sa_rule) return 0 ;;
      esac
    done <<EOF
$_sa_rules
EOF
  done
  return 1
}

# Stdin is read ONCE, here, and replayed into main() — main() still does
# its own `jq` read of the tool JSON, unchanged. The copy is what lets the
# static-allowlist gate below see the command text after main() has
# returned empty.
payload=$(cat)
cmd_seen=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""' 2>/dev/null) || cmd_seen=""
# The session's own permission mode, straight from the harness (empty on
# harness versions that don't send it — then the ps-walk fallback rules).
perm_mode_seen=$(printf '%s' "$payload" | jq -r '.permission_mode // ""' 2>/dev/null) || perm_mode_seen=""
# The session's cwd — the ONLY signal that says which git tree a bare
# `git cherry-pick <sha>` will act on (2026-09-03). Empty on harness
# versions that don't send it, which keeps cherry-pick prompting exactly
# as it did before: absent evidence never grants.
cwd_seen=$(printf '%s' "$payload" | jq -r '.cwd // ""' 2>/dev/null) || cwd_seen=""
export HOOK_CWD_SEEN="$cwd_seen"

# `|| true` keeps `set -e` from aborting here when main() exits non-zero
# inside the substitution; an `exit 0` in main() ends only that subshell.
out=$(printf '%s' "$payload" | main) || true

if [ -n "$out" ]; then
  printf '%s\n' "$out"
  exit 0
fi

# UNION of both signals (2026-08-30, learned live on the first post-
# overhaul engine boot): a generic subagent of the dontAsk engine can
# carry a PROMPTING effective mode of its own (only agent definitions
# with permissionMode frontmatter pin dontAsk), so its payload field
# says "default" while its prompt still lands in the unwatched engine
# window. The ps-walk sees the engine ancestor regardless of what the
# subagent's own mode reports — so run it whenever the payload doesn't
# already say dontAsk, not only when the field is absent.
if { [ "$perm_mode_seen" = "dontAsk" ] || _hook_under_engine; } && ! _static_allow_hit "$cmd_seen"; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"denied under dontAsk: command shape not allowlistable. Rewrite as one plain command per Bash call (no && / ; / pipes into unlisted commands, no heredoc/redirect, no $(…), invoke tools via pnpm exec / npx not node_modules/.pnpm paths). Never ask the user."}}'
  exit 0
fi

exit 0
