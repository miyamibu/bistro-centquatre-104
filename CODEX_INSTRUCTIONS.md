# Codex Operation Instructions

## Goal
- Provide an explicit, safe operating scaffold for Codex work in this repository while preserving reservation data, recovery evidence, and launch readiness.

## Context
- Repository: `/Users/mimac/Desktop/レストラン予約サイト_本体とバックアップ/bistro-reservation`
- Baseline policy: `AGENTS.md`
- Launch runbook: `docs/production-launch.md`
- Recovery references:
  - `docs/recovery/RECOVERY_RUNBOOK.md`
  - `docs/recovery/SHORTEST_RECOVERY_ROUTE.md`
  - `docs/recovery/COMMAND_TABLE.md`

## Constraints
- Follow `AGENTS.md` safety rules at all times.
- Never expose or commit `.env`, `.env.local`, or secret values.
- Never execute destructive operations for reservation/business/audit/recovery data.
- Do not run production migrations, deployment, push, or external sending without explicit user approval.
- Keep customer booking UX stable unless the task explicitly requests changes.
- Keep edits scoped, minimal, and fully traceable.

## Done when
- Requested changes are implemented only in approved paths.
- Relevant checks are executed (or skipped with explicit reason).
- Output reports changed files, commands/results, and unresolved risks/blockers.
- Recovery and launch guidance remain consistent with repository behavior.

## Output format
1. Change summary
2. Files changed (absolute paths)
3. Commands run and key results
4. Validation status
5. Blockers / follow-ups

## Validation method
- Start with task-specific file/link existence checks.
- Run available repo checks for changed scope (at minimum `npm run lint` when requested).
- If a check cannot run, report exact command, failure point, and reason.

## Failure-handling behavior
- If constraints conflict, stop and report the conflict before proceeding.
- If a command is destructive or stateful and approval is missing, do not execute it.
- If environment/tooling blocks validation, report partial validation and what remains pending.
