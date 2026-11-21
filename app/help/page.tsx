import { HelpSheet } from "./help-sheet";
import { helpLinks } from "./links";

// The URLs come from this deployment's environment, which exists only at
// request time (the image is built once for every environment).
export const dynamic = "force-dynamic";

export default function HelpPage() {
  const { mcpUrl, connectedAppsUrl } = helpLinks();
  return <HelpSheet mcpUrl={mcpUrl} connectedAppsUrl={connectedAppsUrl} />;
}
