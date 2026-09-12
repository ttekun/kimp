# Implementation Kickoff (workflow source of truth)

This file **is** the instruction. If the user asks to follow it — any short form
such as "follow docs/07", "run 07", or "implement according to
docs/07-implementation-kickoff-prompt.md" — **execute this document
immediately**. Do not ask them to paste a prompt. Do not wait for a second copy
of these rules.

Resume state is **not** in this file. Always read
`~/dev/kimchi-premium-clone/PROGRESS.md` → **"Currently working on"** first and
start that task. Update the resume block in PROGRESS.md when you switch tasks;
do not keep a stale task number here.

---

## Role

You are the implementing agent for the kimchi-premium clone. Do the work
yourself in this session: write code, self-check it, run the app/tests, and
track progress.

Do not re-create the retired four-role factory (separate Implementation /
Review / Review-fix / Verification agents on composer-2.5, fable, sonnet).
Search or explore helpers are fine. Same-session self-review is required;
handing a task to another model for "the review role" is not.

## Context

The planning phase is complete. Plan documents live under
`~/dev/kimchi-premium-clone/docs/` (`00-overview.md` through `06-plan-review.md`).
They were validated through 5 rounds of adversarial review
(`06-plan-review.md` — final verdict: **ZERO FINDINGS - APPROVED**).

This file (`07`) is the **workflow** source of truth. Resume state lives in
`PROGRESS.md`.

**Workflow (from 2026-09-05, tightened after adversarial review the same day):**
one agent in one session implements, self-checks (including mutation of new
guards), runs validation, and for I/O or UI tasks records live evidence. The
retired process is the **four-role factory**. Search or explore helpers are
allowed. Do not re-create that four-role loop.

## Source of truth

Read these first, in order, before doing anything else:

1. `~/dev/kimchi-premium-clone/PROGRESS.md` (resume here — "Currently working on")
2. `~/dev/kimchi-premium-clone/docs/07-implementation-kickoff-prompt.md` (this workflow)
3. `~/dev/kimchi-premium-clone/docs/00-overview.md`
4. `~/dev/kimchi-premium-clone/docs/01-site-analysis.md`
5. `~/dev/kimchi-premium-clone/docs/02-architecture.md`
6. `~/dev/kimchi-premium-clone/docs/03-api-integration.md`
7. `~/dev/kimchi-premium-clone/docs/04-ui-design.md`
8. `~/dev/kimchi-premium-clone/docs/05-task-breakdown.md`
9. `~/dev/kimchi-premium-clone/docs/06-plan-review.md` (final approved plan — for context only)

The task list and phase/dependency order in `05-task-breakdown.md` is
authoritative. Do not re-plan or re-architect — that phase is done and was
independently reviewed 5 rounds until zero findings. If you find a genuine
blocking contradiction in the docs during implementation, log it and resolve it
minimally rather than re-opening the whole plan.

## Per-task loop

Repeat for every remaining task in `05-task-breakdown.md`, in dependency order.

1. Mark the task "in progress" in `PROGRESS.md`. Put current status and
   done-criteria in the first screen of "Currently working on" — do not lead
   with a retired reviewer's NOT APPROVED as if this session were blocked on
   that reviewer.
2. Implement per the plan docs. Follow TDD where `05-task-breakdown.md` requires
   it (tests first for `core/` and connectors; new regression tests before or
   with the guard they prove). Do not mark a task done on a green suite that
   never exercised the behavior.
3. Self-check the diff for correctness, adherence to the plan (especially the
   invariants in `02-architecture.md`: staleness rules, price-basis per
   exchange, FX cadence), and code quality. Fix concrete defects before
   declaring done.
4. Mutation gate for new guards and regression tests: temporarily remove or
   invert the production guard (or the assertion that distinguishes capped vs
   uncapped / stale vs fresh). The test MUST fail. Restore the guard and confirm
   the test passes. If the suite stays green with the guard deleted, the test is
   vacuous — not done. Record that you ran this check in `PROGRESS.md`.
5. Run exactly: `pnpm lint`, `pnpm -r typecheck`, `pnpm -r test`,
   `pnpm -r build`, `pnpm format:check`. Green is necessary but not sufficient
   for I/O or UI tasks.
6. For I/O or UI tasks, actually run the relevant surface (server/dev
   environment, real exchange APIs or a controlled test, browser). Do not mark
   the task complete without evidence in `PROGRESS.md` (command output,
   screenshot, or log excerpt). This is the same bar that caught Upbit `code`
   vs `market` when mocked tests were green.
7. If a check fails, fix it in this session and re-run steps 4–6. Do not hand
   off to a Review-fix or Verification subagent.
8. On success, update `PROGRESS.md`: mark the task complete only when that
   task's stated done-criteria are met (HIGH/MEDIUM items closed; LOW items
   explicitly accepted or rejected in the log — do not silently drop them).
   Timestamp, one-line summary, deviations from plan.
9. Move to the next task per dependency order.

## Progress tracking (mandatory)

Maintain `~/dev/kimchi-premium-clone/PROGRESS.md` with:

- A checklist mirroring the phases/tasks in `05-task-breakdown.md` (`- [ ]` / `- [x]`)
- For each completed task: timestamp, one-line summary, any notable deviation
  from plan, and whether the mutation gate and (if applicable) live evidence ran
- A "Currently working on" block at the top, updated every time you switch
  tasks, so that if this session is interrupted or compacted, a fresh read of
  `PROGRESS.md` tells you (or a future session) exactly where to resume — treat
  that file as the resumability anchor, not just a log
- Update `PROGRESS.md` incrementally as you go, not just at the end

When handing off to a **new session**, refresh "Currently working on" (done-criteria,
starting files, out of scope, and the remaining task queue if the user asked to
run through multiple tasks). Do **not** require the user to copy a prompt;
this file plus `PROGRESS.md` is enough. Do not stop after one task just to
hand off, unless the next work is blocked (for example a 24 h wall-clock soak
that cannot finish in-session, after any tasks whose dependencies are already
met have been started).

## Autonomy

The user wants this to run through to completion with as little hand-holding as
possible. Proceed through tasks and phases without stopping to ask for
confirmation on routine implement / self-check / run steps. Still pause and ask
the user before any action that is genuinely destructive, hard to reverse, or
affects shared/external state (force-push, deleting data, deploying to a real
production endpoint, spending money on a paid API tier, etc.) — routine local
development work does not require that pause.

If you hit a genuine blocker that isn't resolvable by iterating the loop above
(e.g. an external API changed shape, a required credential is missing, the plan
has a real gap that can't be minimally patched), stop, update `PROGRESS.md`
with the blocker clearly marked, and report to the user rather than guessing
past it.

## Start now

Read `PROGRESS.md` "Currently working on". Implement **that** task until its
done-criteria are met, then continue remaining checklist items in
`05-task-breakdown.md` dependency order (including any later tasks listed in
the resume block). Do not invent a stop after a single task. A wall-clock soak
(Task 5.2) is **not** a standing gate — if `PROGRESS.md` marks 5.2 waived or
complete, proceed. Do not start 7.x until 5.x and 6.x are both complete on
the checklist. Pause only for the Autonomy exceptions (real production
deploy unless already approved in `PROGRESS.md`, paid APIs, destructive git,
etc.).
