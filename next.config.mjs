import { withSentryConfig } from "@sentry/nextjs/config";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// Pin the workspace root to this project so the standalone build and Turbopack
// don't infer a parent directory (which broke `tailwindcss` resolution in dev).
const projectRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: projectRoot,
  // `tsc --noEmit` already runs as a dedicated PR-check step before anything
  // merges to main, so re-running the type-check inside `next build` during the
  // Docker image build is redundant work (~45s saved). Skip it; `main` stays
  // gated by the PR checks. (Next 16 no longer runs ESLint during `next build`,
  // and lint runs in the PR checks regardless.)
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {
    root: projectRoot,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.r2.dev",
      },
    ],
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: process.env.SENTRY_ORG || "",
  project: process.env.SENTRY_PROJECT || "",

  // Be loud about source-map upload in CI, quiet locally.
  //
  // This used to key on CI, which is never set inside the Docker build --
  // buildx does not inherit the host environment and nothing passed it in. So
  // silent was always true and upload failures produced no output at all: a
  // wrong org/project slug gave a green build, a healthy deploy, and stack
  // traces that silently stopped symbolicating. SENTRY_VERBOSE is passed as a
  // build arg from cloudbuild.yaml and read by nothing else, so turning it on
  // cannot change how npm or next build behave.
  silent: !process.env.SENTRY_VERBOSE,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  // Associate uploaded source maps + runtime events with the git SHA so Sentry
  // can do release tracking (regressions, "first seen in release X"). Provided at
  // build time via Cloud Build's SHORT_SHA (matches the deployed image tag);
  // absent for local builds, where Sentry auto-detects. Symbolication itself runs
  // off debug IDs and does not depend on this.
  ...(process.env.SENTRY_RELEASE && {
    release: { name: process.env.SENTRY_RELEASE },
  }),
});
