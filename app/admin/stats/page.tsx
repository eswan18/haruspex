import { sheetCss } from "@/components/prop-list/sheet";
import { getAdminStats } from "@/lib/db_actions/admin-stats";
import { handleServerActionResult } from "@/lib/server-action-helpers";

import { StatsSheet } from "./stats-sheet";

export default async function StatsPage() {
  const stats = handleServerActionResult(await getAdminStats());
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: sheetCss }} />
      <StatsSheet stats={stats} />
    </>
  );
}
