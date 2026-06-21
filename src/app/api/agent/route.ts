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
      direct_completion: null,
      handoff: {
        template:
          "/booking?mode=agent&date={YYYY-MM-DD}&servicePeriod={LUNCH|DINNER}&partySize={1-12}&arrivalTime={HH:MM}&course={URL_ENCODED_COURSE}",
        purpose: "Required human review and submit bridge",
        notes: [
          "AI direct reservation completion is launch-disabled until dedicated AI authentication exists.",
          "Do not send personal data through query strings.",
          "Use the handoff URL for non-sensitive booking preferences only.",
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
      "Seat reservations must be handed off to /booking for human review and final submission.",
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
