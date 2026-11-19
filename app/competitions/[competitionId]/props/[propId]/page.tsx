import { notFound } from "next/navigation";

import ErrorPage from "@/components/pages/error-page";
import {
  buildField,
  toPropWithUserForecast,
} from "@/components/prop-sheet/build";
import { PropSheet } from "@/components/prop-sheet/prop-sheet";
import { getForecasts, getPropById } from "@/lib/db_actions";
import { getCurrentUserRole } from "@/lib/db_actions/competition-members";
import { getPropStatusFromProp } from "@/lib/prop-status";
import { canResolveProp } from "@/lib/prop-write-access";
import { competitionAccess } from "../../access";
import { AccessDenied } from "../../access-denied";

export default async function Page({
  params,
}: {
  params: Promise<{ competitionId: string; propId: string }>;
}) {
  const { competitionId: idString, propId: propIdString } = await params;
  const propId = parseInt(propIdString, 10);
  if (isNaN(propId)) {
    return <ErrorPage title={`Invalid prop ID '${propIdString}'`} />;
  }

  const access = await competitionAccess(idString);
  if (!access.ok) return <AccessDenied access={access} />;
  const { competition, user } = access;

  const propResult = await getPropById(propId);
  if (!propResult.success) return <ErrorPage title={propResult.error} />;
  const propRow = propResult.data;
  // A prop reached through the wrong competition is not this competition's
  // prop, whatever the reader's access to either.
  if (!propRow || propRow.competition_id !== competition.id) notFound();

  const [forecastsResult, roleResult] = await Promise.all([
    getForecasts({ propId }),
    // `access.isAdmin` only consults the membership role for private
    // competitions; editing a prop is a competition-admin power in both.
    getCurrentUserRole(competition.id),
  ]);
  if (!forecastsResult.success) {
    return <ErrorPage title={forecastsResult.error} />;
  }
  const forecasts = forecastsResult.data;
  const isAdmin =
    user.is_admin || (roleResult.success && roleResult.data === "admin");

  const prop = toPropWithUserForecast(propRow, forecasts, user.id);
  return (
    <PropSheet
      prop={prop}
      field={buildField(forecasts, user.id)}
      forecasterCount={new Set(forecasts.map((f) => f.user_id)).size}
      currentUserId={user.id}
      canForecast={getPropStatusFromProp(prop) === "open"}
      canEdit={isAdmin || prop.prop_user_id === user.id}
      canResolve={canResolveProp({
        userId: user.id,
        ownerId: prop.prop_user_id,
        role: roleResult.success ? roleResult.data : null,
        isSiteAdmin: user.is_admin,
      })}
      back={{
        href: `/competitions/${competition.id}`,
        label: competition.name,
      }}
    />
  );
}
