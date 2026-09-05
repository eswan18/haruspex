import { Generated, Insertable, Selectable, Updateable } from "kysely";

import type { PropKind } from "@/lib/prop-kind";

export interface Database {
  categories: CategoriesTable;
  competitions: CompetitionsTable;
  competition_members: CompetitionMembersTable;
  feature_flags: FeatureFlagsTable;
  forecast_options: ForecastOptionsTable;
  forecasts: ForecastsTable;
  prop_options: PropOptionsTable;
  props: PropsTable;
  resolution_options: ResolutionOptionsTable;
  resolutions: ResolutionsTable;
  suggested_props: SuggestedPropsTable;
  users: UsersTable;
  v_props: VPropsView;
  v_prop_options: VPropOptionsView;
  v_forecasts: VForecastsView;
  v_users: VUsersView;
  v_suggested_props: VSuggestedPropsView;
  v_feature_flags: VFeatureFlagsView;
  v_competition_members: VCompetitionMembersView;
}

// Tables

export interface UsersTable {
  id: Generated<number>;
  name: string;
  email: string;
  is_admin: boolean;
  deactivated_at: Date | null;
  idp_user_id: string | null; // UUID from IDP
  username: string | null; // Username from IDP, updated on each login
  picture_url: string | null; // Avatar URL from IDP, updated on each login
  updated_at: Generated<Date>;
  created_at: Generated<Date>;
}
export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;

/**
 * The columns of a user that may be shown to a DIFFERENT user.
 *
 * Everything else on `users` is either personal data (`email`), an identifier
 * that follows the person across the whole fleet (`idp_user_id`), or a fact
 * about their privileges (`is_admin`, `deactivated_at`). Those belong to that
 * user's own session, or to an admin, and nowhere else.
 *
 * This boundary is not enforced by the database, and deliberately so. Column
 * privileges cannot express it, because the app connects as a single role
 * (`app_user`) for admins and members alike, and RLS is row-level where this
 * problem is column-level. A narrower view would not help either: the session
 * user legitimately reads its own full row, and `lib/get-user.ts` reads it
 * before any session exists to test a policy against.
 *
 * So it is a type, and its value is that widening it has to be deliberate.
 * Prefer it over hand-written inline shapes when returning other people's rows.
 */
export type PublicUser = Pick<
  User,
  "id" | "name" | "username" | "picture_url"
>;

export interface CategoriesTable {
  id: Generated<number>;
  name: string;
  updated_at: Generated<Date>;
  created_at: Generated<Date>;
}
export type Category = Selectable<CategoriesTable>;
export type NewCategory = Insertable<CategoriesTable>;
export type CategoryUpdate = Updateable<CategoriesTable>;

export interface PropsTable {
  id: Generated<number>;
  text: string;
  /** Fixed at creation; a database trigger rejects any change. */
  kind: Generated<PropKind>;
  category_id: number | null;
  notes: string | null;
  user_id: number | null;
  competition_id: number | null;
  forecasts_due_date: Date | null;
  resolution_due_date: Date | null;
  created_by_user_id: number | null;
  updated_at: Generated<Date>;
  created_at: Generated<Date>;
}
export type Prop = Selectable<PropsTable>;
export type NewProp = Insertable<PropsTable>;
export type PropUpdate = Updateable<PropsTable>;

export interface ForecastsTable {
  id: Generated<number>;
  prop_id: number;
  user_id: number;
  /** Set for binary props, null for choice props (per-option rows instead). */
  forecast: number | null;
  updated_at: Generated<Date>;
  created_at: Generated<Date>;
}
export type Forecast = Selectable<ForecastsTable>;
export type NewForecast = Insertable<ForecastsTable>;
export type ForecastUpdate = Updateable<ForecastsTable>;

export interface ResolutionsTable {
  id: Generated<number>;
  prop_id: number;
  /** Set for binary props, null for choice props (per-option rows instead). */
  resolution: boolean | null;
  notes: string | null;
  user_id: number | null;
  updated_at: Generated<Date>;
  created_at: Generated<Date>;
}
export type Resolution = Selectable<ResolutionsTable>;
export type NewResolution = Insertable<ResolutionsTable>;
export type ResolutionUpdate = Updateable<ResolutionsTable>;

export interface SuggestedPropsTable {
  id: Generated<number>;
  suggester_user_id: number;
  prop: string;
  updated_at: Generated<Date>;
  created_at: Generated<Date>;
}
export type SuggestedProp = Selectable<SuggestedPropsTable>;
export type NewSuggestedProp = Insertable<SuggestedPropsTable>;
export type SuggestedPropUpdate = Updateable<SuggestedPropsTable>;

export interface FeatureFlagsTable {
  id: Generated<number>;
  name: string;
  user_id: number | null;
  enabled: boolean;
  updated_at: Generated<Date>;
  created_at: Generated<Date>;
}
export type FeatureFlag = Selectable<FeatureFlagsTable>;
export type NewFeatureFlag = Insertable<FeatureFlagsTable>;
export type FeatureFlagUpdate = Updateable<FeatureFlagsTable>;

export interface CompetitionsTable {
  id: Generated<number>;
  name: string;
  forecasts_close_date: Date | null;
  forecasts_open_date: Date | null;
  end_date: Date | null;
  is_private: Generated<boolean>;
  created_by_user_id: number | null;
  updated_at: Generated<Date>;
  created_at: Generated<Date>;
}
export type Competition = Selectable<CompetitionsTable>;
export type NewCompetition = Insertable<CompetitionsTable>;
export type CompetitionUpdate = Updateable<CompetitionsTable>;

export interface CompetitionMembersTable {
  id: Generated<number>;
  competition_id: number;
  user_id: number;
  role: "admin" | "forecaster";
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}
export type CompetitionMember = Selectable<CompetitionMembersTable>;
export type NewCompetitionMember = Insertable<CompetitionMembersTable>;
export type CompetitionMemberUpdate = Updateable<CompetitionMembersTable>;

export interface PropOptionsTable {
  id: Generated<number>;
  prop_id: number;
  text: string;
  /** 0-based display order; unique within a prop. */
  position: number;
  updated_at: Generated<Date>;
  created_at: Generated<Date>;
}
export type PropOption = Selectable<PropOptionsTable>;
export type NewPropOption = Insertable<PropOptionsTable>;

export interface ForecastOptionsTable {
  forecast_id: number;
  prop_id: number;
  option_id: number;
  probability: number;
  updated_at: Generated<Date>;
  created_at: Generated<Date>;
}
export type NewForecastOption = Insertable<ForecastOptionsTable>;

export interface ResolutionOptionsTable {
  resolution_id: number;
  prop_id: number;
  option_id: number;
  outcome: boolean;
  updated_at: Generated<Date>;
  created_at: Generated<Date>;
}
export type NewResolutionOption = Insertable<ResolutionOptionsTable>;

// Views

export interface VPropsView {
  prop_id: number;
  prop_text: string;
  prop_notes: string | null;
  prop_kind: PropKind;
  prop_user_id: number | null;
  prop_forecasts_due_date: Date | null;
  prop_resolution_due_date: Date | null;
  prop_created_by_user_id: number | null;
  category_id: number | null;
  category_name: string | null;
  competition_id: number | null;
  competition_name: string | null;
  competition_is_private: boolean | null;
  competition_forecasts_close_date: Date | null;
  competition_forecasts_open_date: Date | null;
  resolution_id: number | null;
  resolution: boolean | null;
  resolution_user_id: number | null;
  resolution_notes: string | null;
}
export type VProp = Selectable<VPropsView>;

export type PropWithUserForecast = VProp & {
  /** Binary props only; null for choice props. */
  user_forecast: number | null;
  /** Set for both kinds; the "has this user forecasted" test. */
  user_forecast_id: number | null;
  /** Binary props only; null for choice props. */
  community_average: number | null;
  /** Empty for binary props. */
  options: PropOptionSummary[];
};

export interface VPropOptionsView {
  option_id: number;
  prop_id: number;
  option_text: string;
  position: number;
  outcome: boolean | null;
}
export type VPropOption = Selectable<VPropOptionsView>;

/** One option of a choice prop as every UI surface sees it. */
export interface PropOptionSummary {
  option_id: number;
  text: string;
  position: number;
  /** Resolved outcome; null while the prop is open. */
  outcome: boolean | null;
  /** The requesting user's probability, null if they have not forecasted. */
  user_forecast: number | null;
  community_average: number | null;
}

export interface VForecastsView {
  category_id: number | null;
  category_name: string | null;
  competition_id: number | null;
  competition_name: string | null;
  competition_is_private: boolean | null;
  competition_forecasts_close_date: Date | null;
  competition_forecasts_open_date: Date | null;
  forecast_id: number;
  /** Set for binary props, null for choice props. */
  forecast: number | null;
  forecast_created_at: Date;
  forecast_updated_at: Date;
  prop_id: number;
  prop_text: string;
  prop_notes: string | null;
  prop_kind: PropKind;
  prop_user_id: number | null;
  prop_forecasts_due_date: Date | null;
  prop_resolution_due_date: Date | null;
  prop_created_by_user_id: number | null;
  resolution_id: number | null;
  resolution: boolean | null;
  resolution_user_id: number | null;
  resolution_notes: string | null;
  resolution_created_at: Date | null;
  resolution_updated_at: Date | null;
  score: number | null;
  user_id: number;
  user_name: string;
}
export type VForecast = Selectable<VForecastsView>;

export interface VUsersView {
  id: number;
  name: string;
  email: string;
  is_admin: boolean;
  deactivated_at: Date | null;
  idp_user_id: string | null; // UUID from IDP
  username: string | null; // Username from IDP
  picture_url: string | null; // Avatar URL from IDP
  created_at: Date;
  updated_at: Date;
}
export type VUser = Selectable<VUsersView>;

export interface VSuggestedPropsView {
  id: number;
  prop_text: string;
  user_id: number;
  user_name: string;
  user_email: string;
}
export type VSuggestedProp = Selectable<VSuggestedPropsView>;

export interface VFeatureFlagsView {
  id: number;
  name: string;
  user_id: number | null;
  enabled: boolean;
  user_name: string | null;
  user_email: string | null;
  user_is_admin: boolean | null;
}
export type VFeatureFlag = Selectable<VFeatureFlagsView>;

export interface VCompetitionMembersView {
  membership_id: number;
  competition_id: number;
  user_id: number;
  role: "admin" | "forecaster";
  membership_created_at: Date;
  membership_updated_at: Date;
  competition_name: string;
  competition_is_private: boolean;
  user_name: string;
  user_email: string;
  user_username: string | null;
  user_picture_url: string | null;
}
export type VCompetitionMember = Selectable<VCompetitionMembersView>;
