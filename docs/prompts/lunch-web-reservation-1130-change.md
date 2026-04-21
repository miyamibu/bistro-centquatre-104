# ランチ予約開始時刻を11:30に変更する実装プロンプト

## Issue Map

- 変更の中心は `src/lib/reservation-config.ts` のランチ `reservationHours.start`。
- この値から予約フォーム候補や API バリデーションは連動しているが、案内文にはハードコードが残っている。
- そのため、設定変更だけでは不十分で、AI 向けガイド・LLM 向け文言・画面上の説明・テスト期待値もそろえて更新する必要がある。
- 今回の主目的は「ランチの Web 予約可能開始時刻を 11:00 から 11:30 に変えること」。営業時間そのものは既存のまま `11:00-14:00` を維持する前提で進める。

## 実行用プロンプト

```text
Goal
- 予約管理サイトで、ランチの Web 予約可能開始時刻を 11:00 から 11:30 に変更する。
- 設定、UI、API 説明、LLM/Agent 向けガイド、テストを一貫して更新し、古い 11:00 開始の案内が残らない状態にする。

Context
- 対象プロジェクト: /Users/mimac/Desktop/レストラン予約サイト_本体とバックアップ/bistro-reservation
- 現在の主要設定は `src/lib/reservation-config.ts` にあり、ランチは以下のようになっている。
  - 営業時間: 11:00-14:00
  - Web予約可能時間: 11時台開始（変更前）
  - 30分刻み
- 今回変更したいのは「予約可能時間の開始」のみで、営業時間の開始まで 11:30 に変える要求ではない。
- つまり想定結果は以下。
  - ランチ営業時間: 11:00-14:00 のまま
  - ランチ Web予約可能時間: 11:30-12:30
  - ランチ来店候補: 11:30, 12:00, 12:30
- ファイル確認の結果、少なくとも次の層に影響がある。
  - 設定/派生文言: `src/lib/reservation-config.ts`
  - 予約枠ロジック: `src/lib/booking-rules.ts`
  - FAQ/同期文言: `src/lib/reservation-copy.ts`
  - Agent API 説明: `src/app/api/agent/route.ts`
  - llms.txt: `src/app/llms.txt/route.ts`
  - inline LLM instructions: `src/app/layout.tsx`
  - Agents ページ表示: `src/app/agents/page.tsx`
  - 予約フォームや Agent builder は設定値参照のため、影響確認対象に含める
  - テスト: 少なくとも `tests/rules.test.ts` と、必要に応じて arrivalTime の期待値を持つ関連テスト

Constraints
- まず関連ファイルを確認してから編集すること。推測だけで変更しないこと。
- 変更対象は「ランチの Web予約開始時刻」。ディナー時間帯、締切ルール、貸切ロジック、定休日ルールは変更しないこと。
- ランチ営業時間 `11:00-14:00` は維持すること。`businessHours` まで 11:30 に変更しないこと。
- `reservationHours.start` の変更に合わせて、画面表示・エージェント向け説明・LLM向け説明・テストを必ず同期すること。
- `11:00` という文字列を機械的に全置換しないこと。ランチ営業時間として正しい箇所は残すこと。
- 既存コードスタイルに合わせ、必要最小限の差分にすること。
- 変更は `apply_patch` を使って行うこと。

Implementation plan
1. `src/lib/reservation-config.ts` でランチ `reservationHours.start` を `11:30` に変更し、`RESERVATION_WEB_HOURS` のランチ表記を `11:30-12:30` に更新する。
2. `src/lib/booking-rules.ts` を確認し、ランチの候補時刻が `11:30, 12:00, 12:30` になることを確認する。ロジック変更が不要なら設定参照のみでよい。
3. 予約可能時間を説明しているハードコード文言を更新する。
   - `src/app/layout.tsx`
   - `src/app/llms.txt/route.ts`
   - `src/app/api/agent/route.ts`
   - `src/app/agents/page.tsx`
   - `src/lib/reservation-copy.ts`
4. 予約フォーム/UI で `11:00` が候補として残らないことを、設定参照箇所から確認する。
5. テストを更新する。
   - `tests/rules.test.ts` のランチ有効時間、ランチ候補配列
   - ほかにランチ `arrivalTime` の固定期待値があるテストがあれば必要に応じて更新
6. 検証を実行する。
   - `npm run test -- --run tests/rules.test.ts` が使えない構成なら、少なくとも `npm run test`
   - 可能なら `npm run lint`

Validation method
- 次を満たすこと。
  - ランチ予約可能時刻として `11:00` が受理されない
  - ランチ予約可能時刻として `11:30` と `12:30` が受理される
  - ランチ候補一覧が `11:30, 12:00, 12:30` になる
  - 画面説明・Agent/LLM 説明でランチ Web予約時間が `11:30-12:30` に統一される
  - 営業時間表示は `11:00-14:00` のまま変わらない

Done when
- ランチの Web予約開始時刻が 11:30 に変更されている。
- 予約候補・バリデーション・表示文言・Agent/LLM ガイド・テストがすべて整合している。
- 古い「ランチ Web予約 11時台開始」という説明が、意図した例外を除きコード内に残っていない。
- 実行した確認内容と未確認事項が最終報告に明記されている。

Output format
- 最終報告は以下の順で簡潔にまとめること。
  1. 変更概要
  2. 更新した主なファイル
  3. 実行した検証結果
  4. 残る注意点・未確認事項

Failure-handling behavior
- 仕様が衝突している箇所を見つけたら、勝手に広範囲変更せず、どのファイルで何が矛盾しているかを明記する。
- テストや lint が環境要因で実行できない場合は、変更完了扱いにせず、未実行の確認項目として報告する。
- ランチ営業時間まで変更しないと成立しない実装だった場合のみ、その根拠ファイルを添えて方針差分を報告する。
```

## 補足

- 参照した実ファイルでは、`reservation-config.ts` の設定変更だけでフォーム候補や多くのバリデーションは追従する構造だった。
- 一方で `layout.tsx` / `llms.txt/route.ts` / `api/agent/route.ts` / `agents/page.tsx` / `reservation-copy.ts` にはランチの旧開始時刻説明がハードコードされていたため、ここをプロンプトで明示対象に加えている。
- `tests/rules.test.ts` にはランチ候補として `11:00` を期待している箇所があるため、テスト更新も必須。
