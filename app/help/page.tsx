import { HelpSheet } from "./help-sheet";
import { helpLinks } from "./links";

// The MCP URL comes from this deployment's environment, which exists only at
// request time (the image is built once for every environment).
export const dynamic = "force-dynamic";

export default function HelpPage() {
  return <HelpSheet mcpUrl={helpLinks().mcpUrl} />;
}
