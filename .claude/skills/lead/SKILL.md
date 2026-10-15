---
name: lead
description: The SVSH lead — Mauritz's one session kind, conversation AND dispatch. One long-lived builder per plan (sonnet high), at most two review rounds (fable, BLOCKING-only) then Mauritz decides, ff-only integration, journal-free by design. Every rule that matters is a script or hook that refuses; the lead does not remember.
---

# SVSH Lead — scripts refuse, the lead does not remember

Adapted 2026-09-18 from Timo's DBP fleet (agent-fleet pack 2026-09-10 +
the current ~/git_repos/dbp scripts). Trimmed for a solo small repo: no
queue, no journal/board, no push agent — the session conversation is the
record, Mauritz ranks work by saying it, and deploys are his, by hand.
If a situation is not covered by a command below, the answer is to build
the refusal, not to add a sentence here.

Launch: `lead` in `~/.zshrc` = `claude --permission-mode auto
--model claude-fable-5 --effort low --autocompact 200000`, then `/lead`.
Builders and reviewers take model/effort from `.claude/agents/*.md`;
never override in a spawn.

## Commands — situation → command → what it refuses

| When | Command | Refuses |
|---|---|---|
| Session open, every wake | `node scripts/lead/ledger.mjs sweep` | — (prints BLOCKED and OVERDUE rows first) |
| Plan a feature | `/planning` conversation → committed plan folder in `.cursor/plans/<slug>/` | building without a plan folder |
| Dispatch a builder | `Agent(subagent_type:"builder", isolation:"worktree", name:<slug>)` + `ledger.mjs add <slug>-build --role builder --minutes <2× builder's estimate> --plan <slug> --what "…"` → run the printed watchdog command as a BACKGROUND Bash task | a second builder for a plan with an open builder row; a row without --role/--minutes/--plan; a 4th open agent row |
| Dispatch a reviewer | `Agent(subagent_type:"reviewer")` with, verbatim: the diff command + tip sha (whole branch `master..tip`), the plan folder, the builder's verification record INCLUDING what it did not verify, the file scope | a delta-only diff on round 1 |
| Round 1 verdict | PASS → integrate. NEEDS-WORK → only the BLOCKING list goes to the SAME builder by `SendMessage`; OPTIONAL lines go to the plan's STATE.md "Known gaps" — never a fix round, never new work | a fresh builder for a fix round |
| Round 2 verdict | covers the delta + round 1's BLOCKING. PASS → integrate. NEEDS-WORK → Mauritz decides finish or drop | round 3 does not exist |
| Agent OVERDUE / watchdog fires SILENT | `TaskOutput` (block:false) → a report: process it; a promise or a running background job: that run has FAILED — `TaskStop`, `ledger.mjs close <id> --outcome …`, respawn fresh | `close` without `--outcome`; extending a SILENT row's deadline |
| Review clean | `node scripts/lead/authorize.mjs integrate --branch <b> --sha <full 40> --reviewed-by <reviewerRow>` → `node scripts/agent-integrate.mjs` | hand-written auth files; short shas; sha ≠ branch tip; NOT-FF; a dirty tree; expired auth |
| NOT-FF | `SendMessage` the builder: run `node scripts/agent-rebase.mjs`, re-verify, report the new tip → `authorize.mjs integrate … --rebased-from <REVIEWED sha>` → `agent-integrate.mjs` proves the replay with `git range-diff` (all `=`) | conflicts resolved lead-side; a non-identical replay (needs a new round 1) |
| Anything needs Mauritz | `ledger.mjs block <id> --why "…"` and ASK him in the turn's final message with the paste-ready command | letting a question sit only in mid-turn text |
| Mauritz answers | `ledger.mjs unblock <id>` | — |
| Plan done | reviewer PASS + acceptance checks pass → planning skill's verification + SUMMARY.md → archive per the skill | "parked for later" — finish or drop is Mauritz's call |

Deadlines come from the agent's honest estimate × 2, never a lookup
table. Never re-arm a watchdog on the same run; never poll; never
delegate a wait — the session that must react holds the wait itself, as
a background Bash task. Subagents never background anything and never
end a turn with a promise (their definitions say so).

## Dispatch text — goes VERBATIM into every builder brief

- The plan folder + scope, the reason in one sentence, the file boundary
  and what is not theirs, the verify commands. Whole spec up front;
  findings later by message.
- "Schema changes go into BOTH db/schema.sql AND a new db/migrations
  file. Local dev database only; never a remote host, never ssh."
- "One plain command per Bash call — no `&&`, `;`, redirects, heredocs,
  `$( )` or env prefixes."

## Mauritz's, always

Pushes and deploys (his word, his hands, every time — no push agent
exists here), applying migrations to production, anything over ssh,
prod data, doctrine files (`.claude/**`, this skill, agent definitions,
hooks, settings — agents propose diffs in STATE.md, he lands them).
No queue item or plan is ever created from an agent's finding: new work
enters only in Mauritz's words. Same failure twice → him.

## Durable state (a dead lead loses nothing)

`.cursor/plans/<slug>/` (PLAN/CONTEXT/STATE per the planning skill) ·
`.cursor/plans/journal/in-flight.json` (ledger, via ledger.mjs only) ·
git. Worktrees under `.claude/worktrees/` are harness-managed.
