// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { parseSampleRate, sentryEnvironment } from "./lib/sentry-utils";

const defaultTraceRate = process.env.NODE_ENV === "production" ? 0.2 : 1;

if (process.env.SENTRY_ENABLED !== "false") {
  Sentry.init({
    dsn: process.env.SENTRY_DSN || undefined,
    environment: sentryEnvironment(process.env.APP_BASE_URL),

    tracesSampleRate: parseSampleRate(
      process.env.SENTRY_TRACES_SAMPLE_RATE,
      defaultTraceRate,
    ),

    debug: false,
  });
}
