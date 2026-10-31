// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { parseSampleRate } from "./lib/sentry-utils";

const defaultTraceRate = process.env.NODE_ENV === "production" ? 0.2 : 1;

Sentry.init({
  // NEXT_PUBLIC_, not the runtime SENTRY_DSN the server reads: only
  // NEXT_PUBLIC_* is inlined into browser code, at build time (see Dockerfile).
  // Unset in local dev, which leaves the browser client off there.
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,

  // Add optional integrations for additional features
  integrations: [Sentry.replayIntegration()],

  // Use env-configurable sampling; clamp to [0,1] with safe fallback
  tracesSampleRate: parseSampleRate(
    process.env.SENTRY_TRACES_SAMPLE_RATE,
    defaultTraceRate,
  ),

  // Replay sampling
  replaysSessionSampleRate: parseSampleRate(
    process.env.SENTRY_REPLAYS_SESSION_SAMPLE_RATE,
    0.1,
  ),
  replaysOnErrorSampleRate: parseSampleRate(
    process.env.SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE,
    1.0,
  ),

  debug: process.env.NODE_ENV !== "production",
});

// Export the required hook for Sentry navigation instrumentation
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
