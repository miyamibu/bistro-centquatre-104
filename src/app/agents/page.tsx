import Link from "next/link";
import { AgentReservationBuilder } from "@/components/agent-reservation-builder";
import { AgentStoreBuilder } from "@/components/agent-store-builder";

const pageSpacing = { top: 132, bottom: 140 };
const sectionClassName =
  "rounded-3xl border border-[#cfa96d]/40 bg-white/90 p-6 shadow-[0_16px_48px_rgba(47,27,15,0.08)]";

export default function AgentsPage() {
  const reservationEndpoint = "/booking?mode=agent";
  const storeTemplate = "/on-line-store/apron?mode=agent&qty={1-10}";

  return (
    <section
      className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen bg-[radial-gradient(circle_at_top_right,_rgba(247,235,211,0.9),_rgba(232,201,143,0.95)_55%,_rgba(220,192,111,0.95))] px-4"
      style={{
        paddingTop: `${pageSpacing.top}px`,
        paddingBottom: `${pageSpacing.bottom}px`,
      }}
    >
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="space-y-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[#8a6233]">
            Canonical Agent Entry
          </p>
          <h1 className="text-4xl font-semibold tracking-[0.04em] text-[#2f1b0f] md:text-5xl">
            /agents
          </h1>
          <p className="mx-auto max-w-3xl text-sm leading-7 text-[#4a3121] md:text-base">
            This route is the machine-facing entry for external AI agents. Seat reservations and
            store flows are handoffs for human review and final submission.
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          <section className={sectionClassName}>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#8a6233]">
              Reservation
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-[#2f1b0f]">Seat Reservation</h2>
            <p className="mt-3 text-sm leading-7 text-[#4a3121]">
              Agents must hand off reservations to the booking page for human review and final
              submission. Direct API completion is launch-disabled until a dedicated AI
              authentication contract exists.
            </p>
            <div className="mt-5 rounded-2xl bg-[#fff7e6] p-4 text-sm text-[#4a3121]">
              <p className="font-semibold text-[#2f1b0f]">Required handoff entry</p>
              <code className="mt-2 block break-all rounded-xl bg-[#2f1b0f] px-3 py-2 text-xs text-[#f7ebd3]">
                {reservationEndpoint}
              </code>
              <ul className="mt-3 space-y-1 text-xs leading-6">
                <li>Final reservation submission must be completed by a human on `/booking`.</li>
                <li>Do not put names, phone numbers, emails, or addresses in query strings.</li>
                <li>`servicePeriod` must be `LUNCH` or `DINNER` and must match `arrivalTime`.</li>
                <li>Closed weekdays: Monday to Wednesday</li>
                <li>Lunch web reservations: 11:30-12:30 / Dinner: 17:30-19:30</li>
                <li>Web booking cutoff: previous day 17:00 JST</li>
                <li>Availability APIs require `servicePeriod` and `partySize`.</li>
                <li>Parties of 9 or more are always phone-only.</li>
                <li>Put course preference inside `course` or `note` when needed.</li>
              </ul>
            </div>
            <AgentReservationBuilder />
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/booking?mode=agent"
                className="inline-flex items-center justify-center rounded-full bg-[#2f1b0f] px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110"
              >
                Open /booking
              </Link>
              <Link
                href="/access"
                className="inline-flex items-center justify-center rounded-full border border-[#2f1b0f] px-5 py-2 text-sm font-semibold text-[#2f1b0f] transition hover:bg-white/70"
              >
                Review Policies
              </Link>
            </div>
          </section>

          <section className={sectionClassName}>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#8a6233]">
              Store Handoff
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-[#2f1b0f]">Online Store</h2>
            <p className="mt-3 text-sm leading-7 text-[#4a3121]">
              The builder supports catalog-style product selection. Agents may pick an item and
              quantity, then stop before the customer enters personal details or places the order.
              Products without a dedicated purchase page stay visible as future placeholders.
            </p>
            <div className="mt-5 rounded-2xl bg-[#fff7e6] p-4 text-sm text-[#4a3121]">
              <p className="font-semibold text-[#2f1b0f]">Warm handoff template</p>
              <code className="mt-2 block break-all rounded-xl bg-[#2f1b0f] px-3 py-2 text-xs text-[#f7ebd3]">
                {storeTemplate}
              </code>
            </div>
            <AgentStoreBuilder />
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/on-line-store/apron?mode=agent&qty=1"
                className="inline-flex items-center justify-center rounded-full bg-[#2f1b0f] px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110"
              >
                Open Apron Handoff
              </Link>
              <Link
                href="/on-line-store"
                className="inline-flex items-center justify-center rounded-full border border-[#2f1b0f] px-5 py-2 text-sm font-semibold text-[#2f1b0f] transition hover:bg-white/70"
              >
                Browse Store
              </Link>
            </div>
          </section>
        </div>

        <section className={sectionClassName}>
          <div className="grid gap-6 md:grid-cols-[1.2fr_0.8fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#8a6233]">
                Safety Boundaries
              </p>
              <h2 className="mt-3 text-2xl font-semibold text-[#2f1b0f]">Boundary Summary</h2>
              <ul className="mt-4 space-y-3 text-sm leading-7 text-[#4a3121]">
                <li>Seat reservations must be handed off to `/booking` for final human submission.</li>
                <li>Reservation handoff URLs are optional and are safe only for non-sensitive fields.</li>
                <li>
                  Final order submission must be completed by the guest after reviewing `/on-line-store/apron`
                  and `/on-line-store/cart`.
                </li>
                <li>Do not place names, phone numbers, email addresses, or delivery addresses in query strings.</li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#8a6233]">
                Machine Endpoints
              </p>
              <div className="mt-4 space-y-3 text-sm text-[#2f1b0f]">
                <Link
                  href="/llms.txt"
                  className="block rounded-2xl border border-[#cfa96d]/40 bg-[#fff7e6] px-4 py-3 font-semibold transition hover:bg-white"
                >
                  /llms.txt
                </Link>
                <Link
                  href="/api/agent"
                  className="block rounded-2xl border border-[#cfa96d]/40 bg-[#fff7e6] px-4 py-3 font-semibold transition hover:bg-white"
                >
                  /api/agent
                </Link>
                <Link
                  href="/ai"
                  className="block rounded-2xl border border-[#cfa96d]/40 bg-[#fff7e6] px-4 py-3 font-semibold transition hover:bg-white"
                >
                  /ai (legacy alias)
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
