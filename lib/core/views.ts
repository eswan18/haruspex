/**
 * Which rows a core read returns.
 *
 * `"rls"` is what row-level security allows the caller to see, and is what the
 * server actions have always returned; admin pages rely on it.
 * `"member"` narrows that to what the caller is part of: it also drops personal
 * props the caller does not own, and private competitions (and their props)
 * the caller is not a member of.
 */
export type CoreView = "rls" | "member";
