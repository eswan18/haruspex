import { describe, expect, it } from "vitest";

import { compareMigrations } from "./check";

const A = "1731802396765_create-table-suggested-props";
const B = "1731936096261_create-view-v-suggested-props";
const C = "1732111393592_create-table-feature-flags";

function messageOf(result: ReturnType<typeof compareMigrations>): string {
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.message;
}

describe("compareMigrations", () => {
  it("passes when the database has exactly the expected migrations", () => {
    expect(compareMigrations([A, B, C], [A, B, C])).toEqual({ ok: true });
  });

  it("passes regardless of the order rows come back in", () => {
    expect(compareMigrations([A, B, C], [C, A, B])).toEqual({ ok: true });
  });

  it("fails when the database is behind the build", () => {
    const message = messageOf(compareMigrations([A, B, C], [A, B]));

    expect(message).toContain("behind this build");
    expect(message).toContain(C);
    expect(message).not.toContain("ahead of this build");
  });

  it("fails when the database is ahead of the build", () => {
    // An old image rolled back onto a newer schema is just as wrong as a
    // database that hasn't been migrated.
    const message = messageOf(compareMigrations([A, B], [A, B, C]));

    expect(message).toContain("ahead of this build");
    expect(message).toContain(C);
    expect(message).not.toContain("behind this build");
  });

  it("reports both directions when the histories diverge", () => {
    const message = messageOf(compareMigrations([A, B], [A, C]));

    expect(message).toContain("behind this build");
    expect(message).toContain("ahead of this build");
    expect(message).toContain(B);
    expect(message).toContain(C);
  });

  it("fails when the database has no migrations at all", () => {
    const message = messageOf(compareMigrations([A, B], []));

    expect(message).toContain("behind this build");
    expect(message).toContain(A);
    expect(message).toContain(B);
  });

  it("tells the operator how many migrations each side has, and the newest", () => {
    const message = messageOf(compareMigrations([A, B, C], [A]));

    expect(message).toContain("This build expects 3 migration(s), newest: " + C);
    expect(message).toContain("The database has  1 migration(s), newest: " + A);
  });

  it("names running the migrations as the fix", () => {
    const message = messageOf(compareMigrations([A, B], [A]));

    expect(message).toContain("npm exec kysely migrate up");
  });

  it("points a deployed environment at the migrate initContainer", () => {
    // Staging and prod migrate on deploy, so a database still behind there
    // means that initContainer failed or never ran; its logs say why.
    const message = messageOf(compareMigrations([A, B], [A]));

    expect(message).toContain("kubectl logs <pod> -c migrate");
  });

  it("says it does not apply migrations itself", () => {
    const message = messageOf(compareMigrations([A, B], [A]));

    expect(message).toContain("never applies migrations itself");
  });
});
