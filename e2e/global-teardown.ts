/**
 * Stops the app, the IdP stub and Postgres. Playwright runs this after a
 * failed test and after a global setup that threw part-way, so each step
 * tolerates its piece never having started, and every step runs even if an
 * earlier one fails.
 */
import { teardown as stopDatabase } from "../tests/globalSetup";
import { stopApp, stopStub } from "./support/harness";

export default async function globalTeardown(): Promise<void> {
  const failures: unknown[] = [];
  for (const step of [stopApp, stopStub, stopDatabase]) {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "e2e teardown did not finish cleanly");
  }
}
