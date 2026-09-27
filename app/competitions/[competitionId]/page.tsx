import { getCompetitionScores } from "@/lib/db_actions";
import { getPropsWithUserForecasts } from "@/lib/db_actions/forecasts";
import {
  getCurrentUserRole,
  getMemberCount,
} from "@/lib/db_actions/competition-members";
import { canCreateProps } from "@/lib/prop-write-access";
import ErrorPage from "@/components/pages/error-page";
import { buildViewData } from "@/components/competition-view/build-view-data";
import { CompetitionOverview } from "@/components/competition-view/competition-overview";
import { competitionAccess } from "./access";
import { AccessDenied } from "./access-denied";

export default async function Page({
  params,
}: {
  params: Promise<{ competitionId: string }>;
}) {
  const { competitionId: idString } = await params;

  const access = await competitionAccess(idString);
  if (!access.ok) return <AccessDenied access={access} />;

  const { competition, user } = access;
  const competitionId = competition.id;

  const [scoresResult, propsResult, memberCountResult, roleResult] =
    await Promise.all([
      getCompetitionScores({ competitionId }),
      getPropsWithUserForecasts({ userId: user.id, competitionId }),
      competition.is_private
        ? getMemberCount(competitionId)
        : Promise.resolve(null),
      // `access.isAdmin` consults the membership role only for private
      // competitions; writing a prop is a competition-admin power in one and a
      // site-admin power in the other, so ask for the role itself.
      getCurrentUserRole(competitionId),
    ]);

  if (!scoresResult.success) return <ErrorPage title={scoresResult.error} />;
  if (!propsResult.success) return <ErrorPage title={propsResult.error} />;

  const fieldSize =
    memberCountResult && memberCountResult.success
      ? memberCountResult.data
      : scoresResult.data.overallScores.length;

  // One `now` for the whole render, so the markup and the deadline arithmetic
  // agree.
  const now = new Date();
  const data = buildViewData({
    competition,
    props: propsResult.data,
    scores: scoresResult.data,
    fieldSize,
    currentUserId: user.id,
    now,
  });

  // The same rule the new-prop route enforces, asked here so the overview can
  // offer the way in. It is the overview's job because every other link to that
  // form sits behind a non-empty prop list, which a new competition has not got.
  const canWriteProps = canCreateProps({
    isPrivate: competition.is_private,
    role: roleResult.success ? roleResult.data : null,
    isSiteAdmin: user.is_admin,
  });

  return (
    <CompetitionOverview
      data={data}
      currentUserId={user.id}
      now={now}
      showMembers={competition.is_private}
      newPropHref={
        canWriteProps
          ? `/competitions/${competitionId}/props/new`
          : undefined
      }
    />
  );
}
