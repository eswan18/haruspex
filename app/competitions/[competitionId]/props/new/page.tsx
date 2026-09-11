import { getCompetitionById, getSuggestedPropById } from "@/lib/db_actions";
import { getCurrentUserRole } from "@/lib/db_actions/competition-members";
import { getCategories } from "@/lib/db_actions/categories";
import { getUserFromCookies } from "@/lib/get-user";
import ErrorPage from "@/components/pages/error-page";
import { InaccessiblePage } from "@/components/inaccessible-page";
import { NewPropForm } from "@/components/forms/new-prop-form";
import { canCreateProps } from "@/lib/prop-write-access";
import { newPropAudience } from "@/lib/competition-status";

export default async function NewPropPage({
  params,
  searchParams,
}: {
  params: Promise<{ competitionId: string }>;
  /** `?from=<id>` seeds the form from an accepted suggestion. */
  searchParams: Promise<{ from?: string }>;
}) {
  const { competitionId: competitionIdString } = await params;
  const competitionId = parseInt(competitionIdString, 10);

  if (isNaN(competitionId)) {
    return (
      <ErrorPage title={`Invalid competition ID '${competitionIdString}'`} />
    );
  }

  const user = await getUserFromCookies();
  if (!user) {
    return (
      <InaccessiblePage
        title="Not Logged In"
        message="You must be logged in to create propositions."
      />
    );
  }

  const competitionResult = await getCompetitionById(competitionId);
  if (!competitionResult.success) {
    return <ErrorPage title={competitionResult.error} />;
  }
  const competition = competitionResult.data;

  // A private competition is governed by its members, a public one by whoever
  // runs the site; canCreateProps holds that distinction for both this route
  // and the open-props page, which used to keep its own copy of it.
  const roleResult = await getCurrentUserRole(competitionId);
  if (!roleResult.success) {
    return <ErrorPage title={roleResult.error} />;
  }

  if (
    !canCreateProps({
      isPrivate: competition.is_private,
      role: roleResult.data,
      isSiteAdmin: user.is_admin,
    })
  ) {
    return (
      <InaccessiblePage
        title="Unauthorized"
        message={
          competition.is_private
            ? "Only competition admins can create propositions."
            : "Only site admins can create propositions in a public competition."
        }
      />
    );
  }

  const categoriesResult = await getCategories();
  const categories = categoriesResult.success ? categoriesResult.data : [];

  // The suggestion travels as an id, not as text: its claim and notes would
  // otherwise sit in browser history and every access log between here and the
  // server. A bad or unreadable id just yields an empty form -- seeding is a
  // convenience, and failing it should never block writing the prop by hand.
  const { from } = await searchParams;
  const fromId = from ? Number(from) : NaN;
  const suggestion = Number.isInteger(fromId)
    ? await getSuggestedPropById({ id: fromId })
    : null;
  const seed = suggestion?.success ? suggestion.data : null;

  return (
    <NewPropForm
      target={{
        kind: "competition",
        id: competitionId,
        name: competition.name,
        audience: newPropAudience(competition),
      }}
      categories={categories}
      userId={user.id}
      initialText={seed?.prop_text ?? ""}
      initialNotes={seed?.notes ?? null}
    />
  );
}
