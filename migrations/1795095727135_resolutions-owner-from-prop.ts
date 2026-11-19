import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Who may write a resolution: the owner of a personal prop, an admin of the
 * prop's competition, or a site admin.
 *
 * Until now the first of those was written as "the resolution's own user_id
 * is you" (`resolutions.user_id = current_user_id()`), and the option rows'
 * policy asked the same of their header. But resolveProp stamps every
 * resolution it writes with the session user, so that branch admitted anyone
 * who could see the prop: any signed-in reader on a public season's prop, any
 * forecaster on a private competition's. Ownership is now read from the prop
 * (`props.user_id`), which a writer cannot claim without already holding
 * power over the prop: a prop with a user_id is always a personal prop (the
 * `never_both_competition_id_and_user_id_set` check constraint), and
 * `update_props` lets only its owner, its competition's admins or a site
 * admin change it -- each of whom may resolve it anyway. Loosen either and
 * this policy needs revisiting.
 *
 * The option rows' policy now reads its own `prop_id` rather than going
 * through the header. That is the same prop: the composite foreign key
 * `(resolution_id, prop_id) -> resolutions(id, prop_id)` makes it so.
 *
 * The competition-admin and site-admin branches are unchanged. So is
 * `view_resolutions`, which still lets a writer read back their own row.
 * `down()` restores both policies verbatim.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`DROP POLICY manage_resolutions ON resolutions`.execute(db);
  await sql`
    CREATE POLICY manage_resolutions ON resolutions
    FOR ALL
    USING (
      EXISTS (
        SELECT 1 FROM props p
        WHERE p.id = resolutions.prop_id
          AND (
            -- Personal prop owner
            (p.user_id IS NOT NULL AND p.user_id = current_user_id())
            -- Competition admin
            OR (
              p.competition_id IS NOT NULL
              AND is_competition_admin(p.competition_id)
            )
          )
      )
      -- System admins
      OR is_current_user_admin()
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM props p
        WHERE p.id = resolutions.prop_id
          AND (
            (p.user_id IS NOT NULL AND p.user_id = current_user_id())
            OR (
              p.competition_id IS NOT NULL
              AND is_competition_admin(p.competition_id)
            )
          )
      )
      OR is_current_user_admin()
    )`.execute(db);

  await sql`DROP POLICY manage_resolution_options ON resolution_options`.execute(
    db,
  );
  await sql`
    CREATE POLICY manage_resolution_options ON resolution_options
    FOR ALL
    USING (
      EXISTS (
        SELECT 1 FROM props p
        WHERE p.id = resolution_options.prop_id
          AND (
            (p.user_id IS NOT NULL AND p.user_id = current_user_id())
            OR (
              p.competition_id IS NOT NULL
              AND is_competition_admin(p.competition_id)
            )
          )
      )
      OR is_current_user_admin()
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM props p
        WHERE p.id = resolution_options.prop_id
          AND (
            (p.user_id IS NOT NULL AND p.user_id = current_user_id())
            OR (
              p.competition_id IS NOT NULL
              AND is_competition_admin(p.competition_id)
            )
          )
      )
      OR is_current_user_admin()
    )`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP POLICY manage_resolutions ON resolutions`.execute(db);
  await sql`
    CREATE POLICY manage_resolutions ON resolutions
    FOR ALL
    USING (
      -- Personal prop owner
      (resolutions.user_id IS NOT NULL AND resolutions.user_id = current_user_id())
      -- Private competition admin
      OR EXISTS (
        SELECT 1 FROM props p
        WHERE p.id = resolutions.prop_id
          AND p.competition_id IS NOT NULL
          AND is_competition_admin(p.competition_id)
      )
      -- System admins
      OR is_current_user_admin()
    )
    WITH CHECK (
      (resolutions.user_id IS NOT NULL AND resolutions.user_id = current_user_id())
      OR EXISTS (
        SELECT 1 FROM props p
        WHERE p.id = resolutions.prop_id
          AND p.competition_id IS NOT NULL
          AND is_competition_admin(p.competition_id)
      )
      OR is_current_user_admin()
    );
  `.execute(db);

  await sql`DROP POLICY manage_resolution_options ON resolution_options`.execute(
    db,
  );
  await sql`
    CREATE POLICY manage_resolution_options ON resolution_options
    FOR ALL
    USING (
      EXISTS (
        SELECT 1 FROM resolutions r
        WHERE r.id = resolution_options.resolution_id
          AND (
            (r.user_id IS NOT NULL AND r.user_id = current_user_id())
            OR EXISTS (
              SELECT 1 FROM props p
              WHERE p.id = r.prop_id
                AND p.competition_id IS NOT NULL
                AND is_competition_admin(p.competition_id)
            )
            OR is_current_user_admin()
          )
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM resolutions r
        WHERE r.id = resolution_options.resolution_id
          AND (
            (r.user_id IS NOT NULL AND r.user_id = current_user_id())
            OR EXISTS (
              SELECT 1 FROM props p
              WHERE p.id = r.prop_id
                AND p.competition_id IS NOT NULL
                AND is_competition_admin(p.competition_id)
            )
            OR is_current_user_admin()
          )
      )
    )`.execute(db);
}
