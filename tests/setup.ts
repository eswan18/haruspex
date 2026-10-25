import { afterEach, TestRunner } from "vitest";
const getCurrentTest = TestRunner.getCurrentTest;

// Only setup testcontainers if Docker is available and TEST_USE_CONTAINERS is true
const useContainers = process.env.TEST_USE_CONTAINERS === "true";

if (useContainers) {
  // Clean up test data after each test to ensure isolation
  // Note: Container setup/teardown is now handled by globalSetup.ts
  afterEach(async () => {
    const { getTestDb, cleanupTestData } =
      await import("./helpers/testDatabase");
    const { getTrackerForTest, clearTrackerForTest } =
      await import("./helpers/testIdTracker");

    const db = await getTestDb();
    const test = getCurrentTest();
    if (!test) {
      throw new Error("No test found");
    }

    // Get the tracker instance for this specific test
    const tracker = getTrackerForTest(test);
    if (tracker) {
      const trackedIds = tracker.getTrackedIds();

      // Clean up only the tracked IDs for this test
      await cleanupTestData(db, trackedIds);

      // Clear the tracked IDs and remove from registry to prevent memory leaks
      tracker.clear();
      clearTrackerForTest(test);
    }
  });
}
