import { sheetCss } from "@/components/prop-list/sheet";

import {
  AdminSectionList,
  sectionsCss,
  type AdminSection,
} from "./admin-section-list";

const ADMIN_SECTIONS: AdminSection[] = [
  {
    href: "/admin/users",
    title: "Users",
    description: "Browse accounts, manage access, and impersonate users.",
  },
  {
    href: "/admin/competitions",
    title: "Competitions",
    description: "Create competitions and review their props and resolutions.",
  },
  {
    href: "/admin/announcements",
    title: "Announcements",
    description: "Email every active user at once.",
  },
  {
    href: "/admin/feature-flags",
    title: "Feature Flags",
    description: "Toggle features globally or for individual users.",
  },
  {
    href: "/admin/suggested-props",
    title: "Suggested Props",
    description: "Review propositions submitted by forecasters.",
  },
  {
    href: "/admin/forecast-progress",
    title: "Forecast Progress",
    description: "See how far along each forecaster is in a competition.",
  },
];

/**
 * The way in to everything an admin can do. It is an index and nothing else:
 * the description on each line is the only prose the page needs, so the lede
 * that used to repeat them all in one sentence is gone.
 */
export default function AdminIndexPage() {
  return (
    <div className="hxp">
      <style dangerouslySetInnerHTML={{ __html: sheetCss + sectionsCss }} />
      <div className="col">
        <header className="masthead">
          <h1>Admin</h1>
        </header>

        <h2 className="kicker">
          <span>
            Sections
            <span className="aside num"> · {ADMIN_SECTIONS.length}</span>
          </span>
        </h2>

        <AdminSectionList sections={ADMIN_SECTIONS} />
      </div>
    </div>
  );
}
