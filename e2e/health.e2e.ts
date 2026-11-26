import { test, expect } from "./support/fixtures";

test("GET /api/health returns 200", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
});
