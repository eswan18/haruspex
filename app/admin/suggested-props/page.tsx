import { Suspense } from "react";

import { SuggestedPropsReview } from "./suggested-props-review";

/**
 * The review queue reads its filter from the URL, and useSearchParams needs a
 * Suspense boundary above it. Same split as app/props/suggest: a server page
 * whose only job is to render the client component.
 */
export default function SuggestedPropsPage() {
  return (
    <Suspense>
      <SuggestedPropsReview />
    </Suspense>
  );
}
