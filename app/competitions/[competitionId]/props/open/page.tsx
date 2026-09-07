import ErrorPage from "@/components/pages/error-page";
import { getCurrentUserRole } from "@/lib/db_actions/competition-members";
import { canCreateProps } from "@/lib/prop-write-access";
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

  // Open: still forecastable, so its deadline is in the future or absent.
  const now = new Date();
  const open = propsResult.data.filter((p) => {
    const due = competition.is_private
      ? p.prop_forecasts_due_date
      : p.competition_forecasts_close_date;
    return due === null || new Date(due) > now;
  });

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
