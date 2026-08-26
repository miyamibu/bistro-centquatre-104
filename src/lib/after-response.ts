import { after } from "next/server";

/**
 * Keep Next's request-lifecycle primitive behind a small boundary so route
 * unit tests that invoke handlers directly do not pretend to provide a real
 * request scope. Dedicated tests can mock this function and execute the task.
 */
export function scheduleAfterResponse(task: () => Promise<void> | void) {
  if (process.env.VITEST === "true") return;
  after(task);
}
