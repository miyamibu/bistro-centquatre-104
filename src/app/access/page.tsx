import Link from "next/link";
import { CONTACT_PHONE_DISPLAY, CONTACT_TEL_LINK } from "@/lib/contact";
import {
  RESERVATION_BUSINESS_HOURS,
  RESERVATION_BUSINESS_HOURS_TEXT,
  RESERVATION_CLOSED_TEXT,
  RESERVATION_CUTOFF_TEXT,
  RESERVATION_WEB_HOURS,
  RESERVATION_WEB_HOURS_TEXT,
} from "@/lib/reservation-config";

const STORE_ADDRESS = "〒350-0824 埼玉県川越市石原町1丁目47-7";
const GOOGLE_MAP_LINK =
  "https://www.google.com/maps/search/?api=1&query=%E3%80%92350-0824%20%E5%9F%BC%E7%8E%89%E7%9C%8C%E5%B7%9D%E8%B6%8A%E5%B8%82%E7%9F%B3%E5%8E%9F%E7%94%BA1%E4%B8%81%E7%9B%AE47-7";

function MobileHoursList({
  items,
}: {
  items: readonly { label: string; time: string }[];
}) {
  return (
    <div className="space-y-1 text-left md:hidden">
      {items.map((item) => (
        <div key={item.label} className="grid grid-cols-[4.5rem_1fr] gap-x-3">
          <span>{item.label}</span>
          <span>{item.time}</span>
        </div>
      ))}
    </div>
  );
}

export default function InfoPage() {
  const infoSpacing = { topMobile: "76px", topDesktop: "90px", bottom: "80px" };

  return (
    <div
      className="space-y-4 pb-[var(--info-bottom-padding)] pt-[var(--info-top-padding-mobile)] md:pt-[var(--info-top-padding-desktop)]"
      style={{
        "--info-top-padding-mobile": infoSpacing.topMobile,
        "--info-top-padding-desktop": infoSpacing.topDesktop,
        "--info-bottom-padding": infoSpacing.bottom,
      } as Record<string, string>}
    >
      <h1 className="-mt-[26px] text-3xl font-semibold md:mt-0">店舗情報</h1>
      <div className="card space-y-4 border-0 bg-[#fff8ef] p-6 text-[14px] leading-6 text-[#4a3121] shadow-none md:text-base">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#9a6d2f]">
            Reservation & Access
          </p>
          <h2 className="text-2xl font-semibold text-[#2f1b0f]">営業時間を確認したら、そのまま予約できます</h2>
          <p>
            来店日時が決まっている方は Web 予約へ、当日のご相談や満席時の確認はお電話をご利用ください。
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link
            href="/booking"
            className="inline-flex h-11 items-center justify-center rounded-full bg-[#b32626] px-6 text-sm font-semibold tracking-[0.18em] text-white transition hover:brightness-[1.05] active:brightness-[0.98]"
          >
            Web予約へ進む
          </Link>
          <a
            className="inline-flex h-11 items-center justify-center rounded-full border border-[#c7a357]/60 px-6 text-sm font-medium tracking-[0.16em] text-[#4a3121] transition hover:bg-white/70"
            href={CONTACT_TEL_LINK}
          >
            電話で相談する
          </a>
          <a
            className="inline-flex h-11 items-center justify-center rounded-full border border-[#c7a357]/40 px-6 text-sm font-medium tracking-[0.16em] text-[#4a3121] transition hover:bg-white/70"
            href={GOOGLE_MAP_LINK}
            target="_blank"
            rel="noreferrer"
          >
            地図を開く
          </a>
        </div>
      </div>

      <div className="card space-y-4 p-6 text-[14px] leading-6 text-gray-800 md:text-base">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">営業時間</h2>
          <MobileHoursList items={RESERVATION_BUSINESS_HOURS} />
          <p className="hidden md:block">{RESERVATION_BUSINESS_HOURS_TEXT}</p>
        </div>
        <div className="space-y-1">
          <h2 className="text-xl font-semibold md:hidden">Web予約時間</h2>
          <h2 className="hidden text-xl font-semibold md:block">Web予約</h2>
          <MobileHoursList items={RESERVATION_WEB_HOURS} />
          <p className="hidden md:block">{RESERVATION_WEB_HOURS_TEXT}</p>
          <p>{RESERVATION_CUTOFF_TEXT}</p>
        </div>
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">定休日</h2>
          <p>{RESERVATION_CLOSED_TEXT}</p>
        </div>
      </div>

      <div className="card space-y-3 p-6 text-[14px] leading-6 text-gray-800 md:text-base">
        <p>
          電話予約：
          <a className="text-brand-700 underline" href={CONTACT_TEL_LINK}>
            {CONTACT_PHONE_DISPLAY}
          </a>
        </p>
        <p>当日のWeb予約は承っておりません。</p>
        <p>満席表示や締切後でもご案内できる場合があります。お電話でご確認ください。</p>
        <p>キャンセルはお電話にてお願いいたします。</p>
        <p>
          詳しい予約条件は
          <Link className="ml-1 underline" href="/faq">
            FAQ
          </Link>
          にも掲載しています。
        </p>
      </div>

      <div className="card space-y-2 p-6 text-[14px] leading-6 text-gray-800 md:text-base">
        <h2 className="text-xl font-semibold">アクセス</h2>
        <p>{STORE_ADDRESS}</p>
        <p>最寄り駅から距離があるため、お車またはタクシーでのご来店もご検討ください。</p>
        <p>駐車場は 5 台分ございます。満車時は近隣コインパーキングをご利用ください。</p>
        <p>
          <a
            className="text-brand-700 underline"
            href={GOOGLE_MAP_LINK}
            target="_blank"
            rel="noreferrer"
          >
            Google Map で場所を確認する
          </a>
        </p>
      </div>
    </div>
  );
}
