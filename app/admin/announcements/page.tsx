import AnnouncementForm from "./announcement-form";

/**
 * One message to everyone. The /admin layout keeps non-admins off the page,
 * and the server actions behind the form check again.
 */
export default function AnnouncementsPage() {
  return <AnnouncementForm />;
}
