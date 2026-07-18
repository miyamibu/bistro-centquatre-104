import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const body = `# AI Agent Guide (bistro centquatre 104)

Primary entry:
- /agents

Legacy alias:
- /ai -> /agents

Reservation:
- Direct completion: POST /api/reservations
- Required JSON fields: date, servicePeriod, partySize, arrivalTime, name, phone
- Optional JSON fields: note, lineIdToken, course
- Required header: Content-Type: application/json
- Optional header: X-Requested-With: XMLHttpRequest
- Optional handoff review URL: /booking?mode=agent&date=YYYY-MM-DD&servicePeriod=LUNCH|DINNER&partySize=2&arrivalTime=18:00&course=...
- servicePeriod must be LUNCH or DINNER and must match arrivalTime.
- Web reservations close at 17:00 JST on the previous day.
- Lunch web reservations accept 11:30-12:30. Dinner web reservations accept 17:30-19:30.
- Availability APIs require servicePeriod and partySize.
- Parties of 9 or more are phone-only.
- Reservations are closed on Mondays, Tuesdays, and Wednesdays.

Store:
- Warm handoff only: /on-line-store/apron?mode=agent&qty=1

Important:
- Final store submission must be completed by a human on the destination page.
- Do not place names, phone numbers, emails, or addresses in query strings. Put personal data in POST bodies only.
- AI agents must not call /api/reservations directly for final booking completion.
- Use /access for business hours, phone contact, and in-person policies.
`;

  return new NextResponse(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
