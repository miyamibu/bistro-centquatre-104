import type { Metadata } from "next";
import { CONTACT_PHONE_DISPLAY, CONTACT_TEL_LINK } from "@/lib/contact";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata("/legal");

export default function LegalPage() {
  return (
    <section className="px-0 pb-20 pt-[28px] md:pb-24 md:pt-[112px]">
      <div className="mx-auto max-w-3xl space-y-8 text-[#2f1b0f]">
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-[#b68c5a]">Legal Notice</p>
          <h1 className="text-3xl font-semibold md:text-4xl">特定商取引法に基づく表記</h1>
          <p className="text-sm leading-7 text-[#4a3121] md:text-base">
            オンラインストアに関する販売条件と事業者情報を掲載しています。ご購入前にご確認ください。
          </p>
        </div>

        <div className="card border-[#cfa96d]/35 bg-[#fffdfa] p-6 md:p-8">
          <dl className="grid gap-4 text-sm leading-7 md:grid-cols-[12rem,1fr] md:text-base">
            <dt className="font-semibold">販売事業者</dt>
            <dd>bistro centquatre 104</dd>

            <dt className="font-semibold">所在地</dt>
            <dd>〒350-0824 埼玉県川越市石原町1丁目47-7</dd>

            <dt className="font-semibold">電話番号</dt>
            <dd>
              <a
                className="inline-flex min-h-11 items-center underline underline-offset-4"
                href={CONTACT_TEL_LINK}
              >
                {CONTACT_PHONE_DISPLAY}
              </a>
            </dd>

            <dt className="font-semibold">販売価格</dt>
            <dd>各商品ページに税込価格を表示します。</dd>

            <dt className="font-semibold">商品代金以外の必要料金</dt>
            <dd>送料、決済手数料が発生する場合は購入手続き画面に表示します。</dd>

            <dt className="font-semibold">支払方法</dt>
            <dd>購入手続き画面で案内する方法にてお支払いいただきます。</dd>

            <dt className="font-semibold">支払時期</dt>
            <dd>ご注文確定時または各決済事業者の定める時期に課金されます。</dd>

            <dt className="font-semibold">商品の引渡時期</dt>
            <dd>在庫確認後、通常はご注文確定から 7 営業日以内を目安に発送します。</dd>

            <dt className="font-semibold">返品・交換</dt>
            <dd>
              商品に欠陥がある場合を除き、お客様都合による返品・交換は承っておりません。破損や誤配送があった場合は到着後 7 日以内にご連絡ください。
            </dd>

            <dt className="font-semibold">予約の変更・キャンセル</dt>
            <dd>
              予約完了画面または確認メールの管理リンクから、ご来店時刻の24時間前まで無料でキャンセルできます。期限後の変更・キャンセルはお電話で承ります。現在、キャンセル料の設定・自動請求はありません。詳細は FAQ をご確認ください。
            </dd>
          </dl>
        </div>
      </div>
    </section>
  );
}
