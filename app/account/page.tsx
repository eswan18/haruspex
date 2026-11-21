import { getNotificationPreferences } from "@/lib/db_actions";

import { AccountDetails } from "./account-details";

export default async function Page() {
  // Read here rather than in the client: the settings then print with the
  // record, instead of appearing a beat later. A reader who is not signed in
  // gets an error result, and the section simply does not print.
  const preferences = await getNotificationPreferences();

  // The sheet is the page: masthead, record, settings, and the door to the
  // provider. No wrapper heading, because the sheet prints its own.
  return (
    <AccountDetails
      // The public URL: this is a link for the reader's browser. IDP_BASE_URL
      // is identity's in-cluster address, which no browser can reach.
      idpPublicUrl={process.env.IDP_PUBLIC_URL}
      notifications={preferences.success ? preferences.data : null}
    />
  );
}
