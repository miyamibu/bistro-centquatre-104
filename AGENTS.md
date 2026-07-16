# AGENTS

## Repository

- This repository is the reservation site for **bistro centquatre 104**.
- Codex operation scaffold: [CODEX_INSTRUCTIONS.md](/Users/mimac/Desktop/レストラン予約サイト_本体とバックアップ/bistro-reservation/CODEX_INSTRUCTIONS.md)
- Prompt index: [docs/prompts/README.md](/Users/mimac/Desktop/レストラン予約サイト_本体とバックアップ/bistro-reservation/docs/prompts/README.md)

## Prompt/Instruction drafting rules

- Before writing prompts or implementation requests, make `Goal`, constraints, and done criteria explicit.
- For complex requests, produce a short issue map/plan before drafting full prompt text.
- Prompt bodies must include `Goal`, `Context`, `Constraints`, and `Done when`.
- Always state output format, validation method, and failure-handling behavior.
- Keep AGENTS short; move long reusable procedures into skills.
- Manage reusable prompts as skills, not custom prompts.

## Safety rules

- Never read, print, copy, or commit `.env.local` values.
- Never run destructive operations against production DB.
- Test DB must use `TEST_DATABASE_URL` only.
- Hard delete is prohibited for `Reservation`, `PrivateBlockAuditLog`, `BusinessDay`, reservation backups, recovery evidence, and production validation evidence.
- Cancellation must be implemented as `Reservation.status = CANCELLED`, not delete.
- No-show must be implemented as `Reservation.status = NOSHOW`, not delete.
- Completed visits must be implemented as `Reservation.status = DONE`, not delete.
- Never run `DELETE`, `TRUNCATE`, `DROP`, Prisma `delete` / `deleteMany`, or destructive cleanup against production or production-linked reservation/business records.
- Cleanup is limited to temporary, generated, and test-only targets. Business records, audit evidence, recovery evidence, backups, and production validation evidence are never cleanup exceptions.
- Cleanup must default to dry-run. If destructive behavior appears necessary, stop, document the need, and ask the user for explicit approval instead of executing it.
- Codex must not delete reservation data, backup files, recovery artifacts, or validation evidence on its own.
- For reservation-removal behavior, prefer status update, archive, or backup-first.

## Change process

- Show planned change targets before implementation.
- Keep booking form UX unchanged.
- Avoid adding unnecessary friction to normal admin operations.
- If customer booking flow changes are needed, document why.

## UI / UX work

- For UI/UX tasks, read `DESIGN.md` before editing code and keep long repeatable procedures in `.agents/skills/`.
- Source of truth priority: current explicit user instruction, existing code/components/design system, `DESIGN.md`, approved Figma/design files, screenshots or `gpt-image-2` images, then ambiguous natural-language preferences.
- Do not implement directly from generated images or screenshots. First convert the visual reference into an implementation brief covering layout, components, tokens, states, responsive behavior, accessibility, risks, and validation.
- If `gpt-image-2` images are generated or received for UI direction, show the options, summarize strengths/risks, and wait for explicit user approval before implementation.
- Do not add new UI, icon, animation, CSS framework, font, or design-token dependencies without explicit approval.
- Do not commit, push, deploy, run production migrations, or alter production data without explicit approval.
- For substantial UI changes, state the validation plan and save available evidence under `artifacts/ui-review/YYYY-MM-DD/`.

## Execution guardrails

- Ask for confirmation before destructive operations, external sending, push, production migrations, or secret rotation.
- After implementation, run available checks: lint, typecheck, test, and security checks.
