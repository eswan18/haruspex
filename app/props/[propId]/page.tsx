import { Suspense } from "react";

import ErrorPage from "@/components/pages/error-page";
import {
  buildField,
  toPropWithUserForecast,
} from "@/components/prop-sheet/build";
import { PropSheet } from "@/components/prop-sheet/prop-sheet";
import { LoadingSheet } from "@/components/stop-sheet/loading-sheet";
import { getForecasts, getPropById } from "@/lib/db_actions";
import { getCurrentUserRole } from "@/lib/db_actions/competition-members";
import { getUserFromCookies } from "@/lib/get-user";
import { getPropStatusFromProp } from "@/lib/prop-status";
import { canResolveProp } from "@/lib/prop-write-access";

export default function PropPage({
  params,
}: {
  params: Promise<{ propId: string }>;
}) {
  return (
    <Suspense fallback={<LoadingSheet rows={4} label="Loading prop" />}>
      <PropPageContent params={params} />
    </Suspense>
  );
}

async function PropPageContent({
  params,
}: {
  params: Promise<{ propId: string }>;
}) {
  const { propId: propIdString } = await params;
  const propId = parseInt(propIdString, 10);
  if (isNaN(propId)) {
    return <ErrorPage title={`Invalid prop ID '${propIdString}'`} />;
  }

  const user = (await getUserFromCookies())!;

  const propResult = await getPropById(propId);
  if (!propResult.success) return <ErrorPage title={propResult.error} />;
  const propRow = propResult.data;
  if (!propRow) return <ErrorPage title="Prop not found" />;

  const forecastsResult = await getForecasts({ propId });
  if (!forecastsResult.success) {
    return <ErrorPage title={forecastsResult.error} />;
  }
  const forecasts = forecastsResult.data;

  // Editing a prop is a competition-admin power as well as a system-admin one,
  // so the prop's competition decides it when it has one.
  let isCompetitionAdmin = false;
  if (propRow.competition_id !== null) {
    const roleResult = await getCurrentUserRole(propRow.competition_id);
    isCompetitionAdmin = roleResult.success && roleResult.data === "admin";
  }

  const prop = toPropWithUserForecast(propRow, forecasts, user.id);
  return (
    <PropSheet
      prop={prop}
      field={buildField(forecasts, user.id)}
      forecasterCount={new Set(forecasts.map((f) => f.user_id)).size}
      currentUserId={user.id}
      canForecast={getPropStatusFromProp(prop) === "open"}
      canEdit={
        user.is_admin || isCompetitionAdmin || prop.prop_user_id === user.id
      }
      canResolve={canResolveProp({
        userId: user.id,
        ownerId: prop.prop_user_id,
        role: isCompetitionAdmin ? "admin" : null,
        isSiteAdmin: user.is_admin,
      })}
      back={
        prop.competition_id !== null && prop.competition_name
          ? {
              href: `/competitions/${prop.competition_id}`,
              label: prop.competition_name,
            }
          : // A prop of your own came from your own list; anyone else's
            // ownerless prop belongs to no list you could return to.
            prop.prop_user_id === user.id
            ? { href: "/props", label: "Your props" }
            : undefined
      }
    />
  );
}
