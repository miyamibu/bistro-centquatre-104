#!/usr/bin/env node

const operation = process.argv.find((value) => value.startsWith("--operation="))?.slice("--operation=".length) ?? "operation";

if (process.env.ALLOW_NONCANONICAL_GO_EXECUTION !== "1") {
  console.error(
    `[noncanonical] ${operation} is blocked for bistro-reservation-go-implementation. Use the canonical bistro-reservation checkout; an explicit compatibility review is required before setting ALLOW_NONCANONICAL_GO_EXECUTION=1.`
  );
  process.exit(1);
}
