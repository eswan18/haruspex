import ErrorPage from "@/components/pages/error-page";
import { getCurrentUserRole } from "@/lib/db_actions/competition-members";
import { canCreateProps } from "@/lib/prop-write-access";
import { isOpenInCompetition } from "@/lib/prop-status";
import { getPropsWithUserForecasts } from "@/lib/db_actions/forecasts";
import { competitionAccess } from "../../access";
import { AccessDenied } from "../../access-denied";
import { OpenPropsPage } from "./open-props-page";

export default async function Page({
  params,
}: {
  params: Promise<{ competitionId: string }>;
}) {
  const { competitionId: idString } = await params;
  const access = await competitionAccess(idString);
  if (!access.ok) return <AccessDenied access={access} />;

  const { competition, user } = access;
  const [propsResult, roleResult] = await Promise.all([
    getPropsWithUserForecasts({
      userId: user.id,
      competitionId: competition.id,
    }),
    // `access.isAdmin` only consults the membership role for private
    // competitions; editing a prop is a competition-admin power in both.
    getCurrentUserRole(competition.id),
  ]);
  if (!propsResult.success) return <ErrorPage title={propsResult.error} />;

  // Open: still forecastable, by the same rule as the competition overview,
  // so a resolved or voided prop is not listed even before its deadline.
  const now = new Date();
  const open = propsResult.data.filter((p) =>
    isOpenInCompetition(p, competition.is_private, now),
  );

  return (
    <OpenPropsPage
      props={open}
      competitionId={competition.id}
      competitionName={competition.name}
      currentUserId={user.id}
      isAdmin={
        user.is_admin || (roleResult.success && roleResult.data === "admin")
      }
      // The same rule the new-prop route enforces, now asked once rather
      // than mirrored here.
      canWriteProps={canCreateProps({
        isPrivate: competition.is_private,
        role: roleResult.success ? roleResult.data : null,
        isSiteAdmin: user.is_admin,
      })}
    />
  );
}
