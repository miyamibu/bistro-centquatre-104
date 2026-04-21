import {
  RESERVATION_BUSINESS_HOURS,
  RESERVATION_WEB_HOURS,
} from "@/lib/reservation-config";
import { RESERVATION_FAQ_ITEMS } from "@/lib/reservation-copy";

const BUSINESS_HOURS_QUESTION = "営業時間を教えてください。";
const WEB_HOURS_QUESTION = "Web予約ができる時間帯を教えてください。";

function MobileHoursList({
  title,
  items,
}: {
  title?: string;
  items: readonly { label: string; time: string }[];
}) {
  return (
    <div className="mt-2 space-y-1 text-left leading-7 md:hidden">
      {title ? <p>{title}</p> : null}
      {items.map((item) => (
        <div key={item.label} className="grid grid-cols-[4.5rem_1fr] gap-x-3">
          <span>{item.label}</span>
          <span>{item.time}</span>
        </div>
      ))}
    </div>
  );
}

function FaqAnswer({ question, answer }: { question: string; answer: string }) {
  if (question === BUSINESS_HOURS_QUESTION) {
    return (
      <>
        <MobileHoursList title="営業時間" items={RESERVATION_BUSINESS_HOURS} />
        <p className="mt-2 hidden leading-7 md:block">{answer}</p>
      </>
    );
  }

  if (question === WEB_HOURS_QUESTION) {
    return (
      <>
        <MobileHoursList title="Web予約可能時間" items={RESERVATION_WEB_HOURS} />
        <p className="mt-2 hidden leading-7 md:block">{answer}</p>
      </>
    );
  }

  return <p className="mt-2 leading-7">{answer}</p>;
}

export default function FaqPage() {
  return (
    <section className="space-y-6 pb-16 pt-[39px] md:pt-20">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8a6233]">FAQ</p>
        <h1 className="text-3xl font-semibold text-[#2f1b0f]">よくあるご質問</h1>
      </header>

      <div className="space-y-4">
        {RESERVATION_FAQ_ITEMS.map((item) => (
          <article
            key={item.question}
            className="rounded-2xl border border-[#cfa96d]/30 bg-white p-5 text-[#4a3121] shadow-sm"
          >
            <h2 className="text-lg font-semibold text-[#2f1b0f]">{item.question}</h2>
            <FaqAnswer question={item.question} answer={item.answer} />
          </article>
        ))}
      </div>
    </section>
  );
}
