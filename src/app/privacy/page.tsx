export default function PrivacyPage() {
  return (
    <section className="px-0 pb-20 pt-[28px] md:pb-24 md:pt-[112px]">
      <div className="mx-auto max-w-3xl space-y-8 text-[#2f1b0f]">
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-[#b68c5a]">Privacy Policy</p>
          <h1 className="text-3xl font-semibold md:text-4xl">プライバシーポリシー</h1>
          <p className="text-sm leading-7 text-[#4a3121] md:text-base">
            bistro centquatre 104 は、ご予約、お問い合わせ、オンラインストアのご利用時にお預かりする個人情報を、以下の方針に基づいて適切に取り扱います。
          </p>
        </div>

        <div className="card space-y-6 border-[#cfa96d]/35 bg-[#fffdfa] p-6 md:p-8">
          <section className="space-y-2">
            <h2 className="text-xl font-semibold">1. 取得する情報</h2>
            <p className="text-sm leading-7 md:text-base">
              氏名、電話番号、メールアドレス、ご予約内容、お問い合わせ内容、配送先情報、購入履歴など、サービス提供に必要な情報を取得します。
            </p>
          </section>
          <section className="space-y-2">
            <h2 className="text-xl font-semibold">2. 利用目的</h2>
            <p className="text-sm leading-7 md:text-base">
              ご予約の確定と連絡、来店前後のご案内、お問い合わせ対応、商品発送、決済確認、不正利用防止、サービス品質向上のために利用します。
            </p>
          </section>
          <section className="space-y-2">
            <h2 className="text-xl font-semibold">3. 第三者提供</h2>
            <p className="text-sm leading-7 md:text-base">
              法令に基づく場合を除き、ご本人の同意なく第三者へ個人情報を提供しません。決済、配送、メール送信など委託先に必要な範囲で情報を共有する場合があります。
            </p>
          </section>
          <section className="space-y-2">
            <h2 className="text-xl font-semibold">4. 保管と管理</h2>
            <p className="text-sm leading-7 md:text-base">
              個人情報へのアクセスを必要最小限に制限し、漏えい、紛失、改ざん、不正アクセスの防止に努めます。保存期間は利用目的に必要な範囲と法令上必要な期間に限ります。
            </p>
          </section>
          <section className="space-y-2">
            <h2 className="text-xl font-semibold">5. LINE通知について</h2>
            <p className="text-sm leading-7 md:text-base">
              ご予約前日のLINEリマインド通知をご希望の場合、LINEアカウントのユーザーIDを予約情報と紐づけて保存します。LINEの友だち追加のみでは予約との自動紐づけは行いません。予約完了画面のリンク、またはLINE公式アカウントの「予約と連携」メニューから設定できます。通知に使用したLINEユーザーIDは、送信ログの信頼性確保のためシステム内に保持します。通知の停止をご希望の場合は、店舗までお電話またはお問い合わせフォームよりご連絡ください。トークン・IDトークン・チャンネルシークレットはログに記録しません。
            </p>
          </section>
          <section className="space-y-2">
            <h2 className="text-xl font-semibold">6. 開示・訂正等のお問い合わせ</h2>
            <p className="text-sm leading-7 md:text-base">
              保有個人情報の開示、訂正、削除等をご希望の場合は、店舗までお電話またはお問い合わせフォームよりご連絡ください。ご本人確認のうえ、法令に従って対応します。
            </p>
          </section>
        </div>
      </div>
    </section>
  );
}
