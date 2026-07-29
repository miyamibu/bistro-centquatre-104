import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const manifest = {
    site: "bistro centquatre 104",
    agent_entry: "/agents",
    legacy_alias: "/ai",
    discovery: {
      llms: "/llms.txt",
      info: "/access",
    },
    routes: {
      reserve: "/booking",
      store: "/on-line-store",
      store_apron: "/on-line-store/apron",
      store_cart: "/on-line-store/cart",
      info: "/access",
    },
    reservation: {
      supports_direct_completion: false,
      closed_weekdays: ["Monday", "Tuesday", "Wednesday"],
      handoff: {
        method: "GET",
        endpoint: "/booking",
        template:
          "/booking?mode=agent&date={YYYY-MM-DD}&servicePeriod={LUNCH|DINNER}&partySize={1-12}&arrivalTime={HH:MM}&course={URL_ENCODED_COURSE}",
        supported_query_fields: [
          "date",
          "servicePeriod",
          "partySize",
          "arrivalTime",
          "course",
        ],
        final_submission: "Human review and submission are required on /booking.",
        notes: [
          "servicePeriod must be LUNCH or DINNER and must match arrivalTime.",
          "Lunch web reservations accept 11:30-12:30 and dinner accepts 17:30-19:30.",
          "Web reservations close at 17:00 JST on the previous day.",
          "Availability APIs require date/month plus servicePeriod and partySize.",
          "Parties of 9 or more are always phone-only.",
          "Do not put names, phone numbers, email addresses, or other personal data in handoff URLs.",
          "Reservations are rejected on Mondays, Tuesdays, and Wednesdays.",
        ],
      },
    },
    store: {
      supports_direct_completion: false,
      warm_handoff: {
        template: "/on-line-store/apron?mode=agent&qty={1-10}",
        stop_before: "Customer details, payment selection, and final order submission",
      },
    },
    boundaries: [
      "AI agents must hand off seat reservations to /booking for human review and final submission.",
      "Store checkout must stop before customer details, payment selection, and final order submission.",
      "Avoid putting personal data in query strings.",
    ],
    compatibility: {
      reservation_handoff_template:
        "/booking?mode=agent&date={YYYY-MM-DD}&servicePeriod={LUNCH|DINNER}&partySize={1-12}&arrivalTime={HH:MM}&course={URL_ENCODED_COURSE}",
      store_handoff_template: "/on-line-store/apron?mode=agent&qty={1-10}",
    },
  };

  const pretty = new URL(request.url).searchParams.get("pretty") === "1";
  const body = pretty ? JSON.stringify(manifest, null, 2) : JSON.stringify(manifest);

  return new NextResponse(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      pragma: "no-cache",
    },
  });
}
