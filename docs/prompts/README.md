# Prompts Index

## Goal
- Provide a discoverable index of reusable prompt docs under `docs/prompts` and clarify how to use them safely.

## Context
- Prompt docs in this folder are implementation request templates for recurring repository tasks.
- Global drafting rules require explicit `Goal`, `Context`, `Constraints`, and `Done when` sections.

## Constraints
- Keep prompt docs concise and task-focused.
- Include output format, validation method, and failure-handling behavior in each prompt.
- Do not place long reusable procedures in global AGENTS; keep them in prompt docs or skills.

## Prompt Files
- `lunch-web-reservation-1130-change.md`: Implementation prompt for changing lunch web-reservation start time from 11:00 to 11:30 while keeping business hours unchanged and aligning UI/API/LLM docs/tests.

## Done when
- Every `docs/prompts/*.md` file is listed with a one-line purpose note.
- New prompt additions update this index in the same change.

## Output format
- Prompt 実行の報告形式は `Change summary` / `Files changed` / `Validation` / `Blockers` を標準とする。

## Validation method
- `docs/prompts/*.md` の実ファイル一覧と index の記載が一致していることを確認する。
- 追加・更新する prompt が `Goal / Context / Constraints / Done when` を含むことを確認する。

## Failure-handling behavior
- index と実ファイルに差分がある場合は、先に差分一覧を出してから修正する。
- 運用方針と矛盾する prompt を検出した場合は即時更新せず、影響範囲を明記して確認する。
