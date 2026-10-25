import { TestRunner } from "vitest";

const getCurrentTest = TestRunner.getCurrentTest;

/**
 * Represents a single tracked database insert.
 */
export interface TrackedInsert {
  table: string;
  id: number;
}

/**
 * Stack of tracked inserts in insertion order.
 * Cleanup will reverse this array to delete in reverse order (guaranteed safe).
 */
export type TrackedIds = TrackedInsert[];

/**
 * Per-test tracker instance.
 * Each test should have its own instance, stored in the test context.
 * Tracks inserts as a stack so cleanup can work in reverse order.
 */
export class TestIdTracker {
  private trackedInserts: TrackedIds = [];

  /**
   * Track an ID for a specific table.
   * Inserts are tracked in order, so cleanup can reverse the order for safe deletion.
   */
  trackId(tableName: string, id: number): void {
    // Avoid duplicates (though this shouldn't happen in practice)
    const exists = this.trackedInserts.some(
      (insert) => insert.table === tableName && insert.id === id,
    );
    if (!exists) {
      this.trackedInserts.push({ table: tableName, id });
    }
  }

  /**
   * Get all tracked inserts in insertion order.
   * For cleanup, reverse this array to delete in reverse order.
   */
  getTrackedIds(): TrackedIds {
    return this.trackedInserts;
  }

  /**
   * Clear all tracked IDs.
   * Should be called after cleanup to prevent memory leaks.
   */
  clear(): void {
    this.trackedInserts = [];
  }
}

/**
 * Registry to store tracker instances per test.
 * Uses test task ID as key for reliable retrieval across contexts.
 */
const trackerRegistry = new Map<string, TestIdTracker>();

/**
 * Get a consistent test ID from the test context or test result.
 * Works with both test contexts (from getCurrentTest) and test results (from onTestFinished).
 */
function getTestId(test: any): string | null {
  // Try task.id first (most reliable, works for both contexts and results)
  if (test?.task?.id) {
    return test.task.id.toString();
  }
  // Fallback to file name + test name combination
  if (test?.file?.name && test?.name) {
    return `${test.file.name}:${test.name}`;
  }
  // For test results, try to get task from result
  if (test?.result?.task?.id) {
    return test.result.task.id.toString();
  }
  return null;
}

/**
 * Get or create a tracker instance for the current test.
 * Stores the tracker keyed by test ID for later retrieval.
 */
export function getTestTracker(): TestIdTracker {
  const test = getCurrentTest();
  if (!test) {
    throw new Error("No test found");
  }
  const testId = getTestId(test);
  if (!testId) {
    throw new Error("No test ID found");
  }
  if (!trackerRegistry.has(testId)) {
    trackerRegistry.set(testId, new TestIdTracker());
  }
  return trackerRegistry.get(testId)!;
}

/**
 * Get the tracker for a specific test (by test object).
 * Used in afterEach hooks to retrieve the tracker.
 */
export function getTrackerForTest(test: any): TestIdTracker | undefined {
  const testId = getTestId(test);
  if (testId) {
    return trackerRegistry.get(testId);
  }
  return undefined;
}

/**
 * Clear tracker for a specific test.
 */
export function clearTrackerForTest(test: any): void {
  const testId = getTestId(test);
  if (testId) {
    trackerRegistry.delete(testId);
  }
}
