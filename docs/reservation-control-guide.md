# Reservation Control Guide

このプロジェクトで予約可否を調整するときの簡易手順です。

## 1. この日を丸ごと予約不可にしたい

使う場所:
- 管理画面 ` /admin/business-days `

手順:
1. 管理画面を開く
2. 日付を選ぶ
3. `この日は休業にする` にチェックを入れる
4. 必要ならメモに `貸切のため` などを書く
5. 保存する

結果:
- その日はランチもディナーも Web 予約不可になります
- カレンダー上でも休業扱いになります

対象コード:
- `/Users/mimac/Desktop/bistro-reservation/src/app/admin/business-days/page.tsx`
- `/Users/mimac/Desktop/bistro-reservation/src/app/api/admin/business-days/route.ts`

## 2. この日のランチだけ予約不可にしたい

使う場所:
- `reservation-config.ts`

編集ファイル:
- `/Users/mimac/Desktop/bistro-reservation/src/lib/reservation-config.ts`

編集する配列:

```ts
closedServicePeriods: [
  {
    date: "2026-04-25",
    servicePeriod: "LUNCH",
  },
]
```

追加例:

```ts
closedServicePeriods: [
  {
    date: "2026-04-25",
    servicePeriod: "LUNCH",
  },
  {
    date: "2026-05-10",
    servicePeriod: "LUNCH",
  },
]
```

結果:
- その日はランチ予約だけ止まります
- ディナー予約は可能なままです
- 予約カレンダーには `夜のみ` と表示されます

補足:
- ディナーだけ止めたいときは `servicePeriod: "DINNER"` を使います

## 3. この日のディナーだけ予約不可にしたい

編集例:

```ts
{
  date: "2026-05-10",
  servicePeriod: "DINNER",
}
```

結果:
- ディナーだけ止まります
- ランチだけ営業にしたい日に使えます

## 4. 変更後の確認

最低限の確認:
1. 予約ページを開く
2. 対象月へ移動する
3. 対象日が `夜のみ` など意図どおりに見えるか確認する
4. 対象日を選んで、来店時間やコースが意図どおりに絞られるか確認する

ローカル確認コマンド:

```bash
cd /Users/mimac/Desktop/bistro-reservation
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
npm test -- tests/reservation-capacity.test.ts
```

## 5. どの方法を使うべきか

- 丸ごと休業にしたい
  - 管理画面 ` /admin/business-days `
- ランチだけ止めたい
  - `closedServicePeriods` に `LUNCH` を追加
- ディナーだけ止めたい
  - `closedServicePeriods` に `DINNER` を追加

## 6. 今の制限

今の管理画面で簡単にできるのは `その日を丸ごと休業` までです。

`ランチだけ不可` や `ディナーだけ不可` は今はコード設定です。
これを管理画面から簡単に切り替えたい場合は、次にやる改修はこれです。

- 管理画面に `ランチ休止` / `ディナー休止` のチェックを追加する
- `closedServicePeriods` 相当を DB に保存する
- 保存後すぐカレンダーへ反映する
