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
      reservations_api: "/api/reservations",
      store: "/on-line-store",
      store_apron: "/on-line-store/apron",
      store_cart: "/on-line-store/cart",
      info: "/access",
    },
    reservation: {
      supports_direct_completion: true,
      closed_weekdays: ["Monday", "Tuesday", "Wednesday"],
      direct_completion: {
        method: "POST",
        endpoint: "/api/reservations",
        required_fields: [
          "date",
          "servicePeriod",
          "partySize",
          "arrivalTime",
          "name",
          "phone",
        ],
        optional_fields: ["note", "lineIdToken", "course"],
        required_headers: {
          "Content-Type": "application/json",
        },
        optional_headers: {
          "X-Requested-With": "XMLHttpRequest",
        },
        notes: [
          "servicePeriod must be LUNCH or DINNER and must match arrivalTime.",
          "Lunch web reservations accept 11:30-12:30 and dinner accepts 17:30-19:30.",
          "Web reservations close at 17:00 JST on the previous day.",
          "Availability APIs require date/month plus servicePeriod and partySize.",
          "Parties of 9 or more are always phone-only.",
          "Put course preference inside course or note when needed.",
          "Send personal data in the JSON body, not in query strings.",
          "Reservations are rejected on Mondays, Tuesdays, and Wednesdays.",
        ],
      },
      handoff: {
        template:
          "/booking?mode=agent&date={YYYY-MM-DD}&servicePeriod={LUNCH|DINNER}&partySize={1-12}&arrivalTime={HH:MM}&course={URL_ENCODED_COURSE}",
        purpose: "Optional review bridge",
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
      "Seat reservations may be completed directly through /api/reservations.",
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
      "cache-control": "public, max-age=3600",
    },
  });
}
