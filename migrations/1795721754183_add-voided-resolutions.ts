import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Voided props: a prop settled with no outcome and scored for nobody, such as
 * a contingent prop whose condition failed ("Voided if OpenAI is not publicly
 * traded at that time"). See docs/superpowers/specs/2026-11-26-voided-props-design.md.
 *
 * A void is a resolution, so the prop's one `resolutions` row still means
 * "settled", and its notes, author and timestamps say why, who and when. Three
 * rules keep a void free of any outcome:
 *
 * - no answer value: a CHECK, since it reads one row;
 * - the kind rule (binary has a value, choice has none) applies only to
 *   resolutions that are not voided: the existing kind trigger, which needs
 *   the prop's kind;
 * - no option outcomes: a constraint trigger on both tables, DEFERRABLE
 *   INITIALLY DEFERRED. resolveProp overwrites by updating the header, then
 *   deleting the old outcomes, then inserting new ones, so voiding a resolved
 *   choice prop sets `voided` while its old outcomes still exist; checked row
 *   by row, a transaction that ends valid would be refused. At commit the
 *   order no longer matters. prop_options_prop_text_unique is deferred for
 *   the same reason.
 *
 * Scores need no new rule to be null (a void has no answer and no outcomes),
 * but v_forecasts.score now says so explicitly rather than relying on how
 * null passes through the formulas.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE resolutions ADD COLUMN voided boolean NOT NULL DEFAULT false`.execute(
    db,
  );
  await sql`ALTER TABLE resolutions ADD CONSTRAINT resolutions_voided_has_no_value CHECK (NOT voided OR resolution IS NULL)`.execute(
    db,
  );

  // The kind rule from 1788220800000, skipped for a void. It is SECURITY
  // DEFINER, so rewriting it is the moment to pin its search_path too.
  await sql`
    CREATE OR REPLACE FUNCTION check_resolution_matches_prop_kind() RETURNS trigger AS $$
    BEGIN
      IF NOT NEW.voided AND ((prop_kind_of(NEW.prop_id) = 'binary') <> (NEW.resolution IS NOT NULL)) THEN
        RAISE EXCEPTION 'resolutions.resolution must be set for binary props and null for choice props (prop %)', NEW.prop_id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp`.execute(
    db,
  );

  // SECURITY DEFINER so row-level security cannot hide the rows it counts,
  // with pg_temp named last so a session's temporary tables cannot shadow
  // the ones it reads.
  await sql`
    CREATE FUNCTION check_voided_resolution_has_no_outcomes() RETURNS trigger AS $$
    DECLARE
      r_id integer;
    BEGIN
      IF TG_TABLE_NAME = 'resolutions' THEN
        r_id := NEW.id;
      ELSE
        r_id := NEW.resolution_id;
      END IF;
      IF EXISTS (SELECT 1 FROM resolutions WHERE id = r_id AND voided)
         AND EXISTS (SELECT 1 FROM resolution_options WHERE resolution_id = r_id) THEN
        RAISE EXCEPTION 'a voided resolution has no option outcomes (resolution %)', r_id;
      END IF;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp`.execute(
    db,
  );
  await sql`
    CREATE CONSTRAINT TRIGGER enforce_voided_no_outcomes
    AFTER INSERT OR UPDATE ON resolutions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_voided_resolution_has_no_outcomes()`.execute(
    db,
  );
  await sql`
    CREATE CONSTRAINT TRIGGER enforce_no_outcomes_when_voided
    AFTER INSERT OR UPDATE ON resolution_options
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_voided_resolution_has_no_outcomes()`.execute(
    db,
  );

  await db.schema.dropView("v_forecasts").execute();
  await db.schema.dropView("v_props").execute();
  await createViews(db, { withVoided: true });
}

export async function down(db: Kysely<any>): Promise<void> {
  // Dropping the column would turn a binary void into a binary resolution
  // with no value, which the restored kind rule forbids (it checks writes,
  // not existing rows, so nothing else here would fail), and a choice void
  // into a resolved prop with no outcomes. Refuse instead.
  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM resolutions WHERE voided) THEN
        RAISE EXCEPTION 'cannot roll back voided props while voided resolutions exist; unresolve or answer them first';
      END IF;
    END
    $$`.execute(db);

  await db.schema.dropView("v_forecasts").execute();
  await db.schema.dropView("v_props").execute();
  await createViews(db, { withVoided: false });

  await sql`DROP TRIGGER enforce_no_outcomes_when_voided ON resolution_options`.execute(
    db,
  );
  await sql`DROP TRIGGER enforce_voided_no_outcomes ON resolutions`.execute(db);
  await sql`DROP FUNCTION check_voided_resolution_has_no_outcomes()`.execute(
    db,
  );

  // Verbatim from 1788220800000.
  await sql`
    CREATE OR REPLACE FUNCTION check_resolution_matches_prop_kind() RETURNS trigger AS $$
    BEGIN
      IF (prop_kind_of(NEW.prop_id) = 'binary') <> (NEW.resolution IS NOT NULL) THEN
        RAISE EXCEPTION 'resolutions.resolution must be set for binary props and null for choice props (prop %)', NEW.prop_id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER`.execute(db);

  await sql`ALTER TABLE resolutions DROP CONSTRAINT resolutions_voided_has_no_value`.execute(
    db,
  );
  await sql`ALTER TABLE resolutions DROP COLUMN voided`.execute(db);
}

/**
 * v_props and v_forecasts as 1788220800000 defined them, plus, with
 * `withVoided`, the resolution's `voided` flag and a score that is null for a
 * void by rule rather than by accident.
 */
async function createViews(
  db: Kysely<any>,
  { withVoided }: { withVoided: boolean },
): Promise<void> {
  const voidedColumn = withVoided
    ? sql`, resolutions.voided AS resolution_voided`
    : sql``;

  await sql`
    CREATE VIEW v_props WITH (security_barrier, security_invoker) AS
    SELECT categories.id AS category_id, categories.name AS category_name,
      props.id AS prop_id, props.text AS prop_text, props.notes AS prop_notes,
      props.kind AS prop_kind,
      props.user_id AS prop_user_id, props.competition_id,
      props.forecasts_due_date AS prop_forecasts_due_date,
      props.resolution_due_date AS prop_resolution_due_date,
      props.created_by_user_id AS prop_created_by_user_id,
      competitions.name AS competition_name, competitions.is_private AS competition_is_private,
      COALESCE(props.forecasts_due_date, competitions.forecasts_close_date) AS competition_forecasts_close_date,
      COALESCE(props.forecasts_due_date, competitions.forecasts_open_date) AS competition_forecasts_open_date,
      resolutions.id AS resolution_id, resolutions.resolution,
      resolutions.notes AS resolution_notes, resolutions.user_id AS resolution_user_id${voidedColumn}
    FROM props
      LEFT JOIN categories ON props.category_id = categories.id
      LEFT JOIN resolutions ON props.id = resolutions.prop_id
      LEFT JOIN competitions ON props.competition_id = competitions.id`.execute(
    db,
  );

  // The score is the per-prop Brier score on the 0–1 scale for every kind:
  // binary is (outcome − p)², one_of is half the multi-category Brier, any_of
  // is the mean of the per-option Briers. NULLIF guards the any_of divisor:
  // the subquery matches no rows while the prop is unresolved, and 1.0/0 is a
  // hard error in postgres rather than NULL, which would break every read of
  // this view as soon as an unresolved any_of prop had a forecast.
  const score = sql`CASE props.kind
        WHEN 'binary' THEN power(resolutions.resolution::integer::double precision - forecasts.forecast, 2::double precision)
        ELSE (
          SELECT SUM(power(ro.outcome::integer::double precision - fo.probability, 2::double precision))
                 * CASE props.kind WHEN 'one_of' THEN 0.5 ELSE 1.0 / NULLIF(COUNT(*), 0) END
          FROM forecast_options fo
          JOIN resolution_options ro
            ON ro.option_id = fo.option_id AND ro.resolution_id = resolutions.id
          WHERE fo.forecast_id = forecasts.id
        )
      END`;
  // A void is scored for nobody.
  const scoreColumn = withVoided
    ? sql`CASE WHEN resolutions.voided THEN NULL ELSE ${score} END AS score`
    : sql`${score} AS score`;

  await sql`
    CREATE VIEW v_forecasts WITH (security_barrier, security_invoker) AS
    SELECT users.id AS user_id, users.name AS user_name,
      categories.id AS category_id, categories.name AS category_name,
      COALESCE(props.forecasts_due_date, competitions.forecasts_close_date) AS competition_forecasts_close_date,
      COALESCE(props.forecasts_due_date, competitions.forecasts_open_date) AS competition_forecasts_open_date,
      props.id AS prop_id, props.text AS prop_text, props.notes AS prop_notes,
      props.kind AS prop_kind,
      props.user_id AS prop_user_id, props.competition_id,
      props.forecasts_due_date AS prop_forecasts_due_date,
      props.resolution_due_date AS prop_resolution_due_date,
      props.created_by_user_id AS prop_created_by_user_id,
      competitions.name AS competition_name, competitions.is_private AS competition_is_private,
      forecasts.id AS forecast_id, forecasts.forecast,
      forecasts.created_at AS forecast_created_at, forecasts.updated_at AS forecast_updated_at,
      resolutions.id AS resolution_id, resolutions.resolution,
      resolutions.notes AS resolution_notes,
      resolutions.created_at AS resolution_created_at, resolutions.updated_at AS resolution_updated_at,
      resolutions.user_id AS resolution_user_id${voidedColumn},
      ${scoreColumn}
    FROM users
      JOIN forecasts ON users.id = forecasts.user_id
      JOIN props ON forecasts.prop_id = props.id
      LEFT JOIN categories ON props.category_id = categories.id
      LEFT JOIN resolutions ON props.id = resolutions.prop_id
      LEFT JOIN competitions ON props.competition_id = competitions.id`.execute(
    db,
  );
}
