import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const body = `# AI Agent Guide (bistro centquatre 104)

Primary entry:
- /agents

Legacy alias:
- /ai -> /agents

Reservation:
- Human handoff only. AI agents must not submit final reservations.
- Required handoff URL: /booking?mode=agent&date=YYYY-MM-DD&servicePeriod=LUNCH|DINNER&partySize=2&arrivalTime=18:00&course=...
- Final review and submission must be completed by a human on /booking.
- servicePeriod must be LUNCH or DINNER and must match arrivalTime.
- Web reservations close at 17:00 JST on the previous day.
- Lunch web reservations accept 11:30-12:30. Dinner web reservations accept 17:30-19:30.
- Availability APIs require servicePeriod and partySize.
- Parties of 9 or more are phone-only.
- Reservations are closed on Mondays, Tuesdays, and Wednesdays.

Store:
- Warm handoff only: /on-line-store/apron?mode=agent&qty=1

Important:
- AI agents must not call POST /api/reservations for final booking completion.
- Final store submission must be completed by a human on the destination page.
- Do not place names, phone numbers, emails, addresses, or other personal data in handoff URLs.
- Use /access for business hours, phone contact, and in-person policies.
`;

  return new NextResponse(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      pragma: "no-cache",
    },
  });
}
