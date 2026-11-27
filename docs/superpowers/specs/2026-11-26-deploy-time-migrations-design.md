# Deploy-Time Migrations — Design

> **Historical.** This document records a plan as it stood when it was written.
> It is kept for the reasoning, not as a description of the codebase — files it
> names may since have been renamed, moved or deleted. Do not read it as
> current guidance, and do not edit it to match today: that would falsify the
> record it exists to be.

**Date:** 2026-11-26
**Status:** approved in conversation (initContainer, Haruspex only); calls
marked *(my call)* were made while writing.

## 1. What and why

Today a migration reaches staging and prod only when someone runs
`DATABASE_URL='<owner url>' npm exec kysely migrate up` by hand, and the
startup check refuses to boot the new image until they do. The owner wants
that step gone: every migration already runs in CI (testcontainers) and again
in staging before prod, so applying it automatically on deploy is low risk.

**Goal:** a staging or prod deploy brings its database to the image's schema
before the app starts, with no manual step.

**Non-goals:** other services (footstrike-api, identity, …) — Haruspex only for
now; changing the startup check (it still refuses a database behind *or* ahead
of the code); migrating down.

**Anti-goals:** the app container holding the owner credential; a deploy that
starts serving against a half-migrated or unmigrated database.

## 2. Approach

**Chosen: an initContainer on the Deployment**, running the migration runner
already compiled into the image (`node /app/migrate/index.js`, haruspex#168)
against the database's owner role. Bifrost preview environments already do
exactly this, so the command, its exit-code contract (0 only when migrated
*and* the startup check passes) and its logging are proven.

Considered and rejected:

- **ArgoCD PreSync hook Job** — runs once per sync rather than per pod, but
  adds hook lifecycle and deletion policy, needs its own CSI mount for the
  secret, and runs on syncs that change nothing about the image. The
  initContainer's per-pod cost is a no-op `migrateToLatest`.
- **Cloud Build** — builds run on every merge to `main`, but prod is promoted
  later with `bif promote`. Migrating prod at build time would put prod's
  database ahead of prod's code, and the startup check would then refuse to
  boot prod's pods.
- **In the app container at startup** — would hand the owner credential to the
  serving process, which deliberately runs as `app_user`.

## 3. Behaviour

- The initContainer uses **the same image as the app container**, so it applies
  exactly the migrations that build was made with — never a newer one. A
  promoted image migrates prod when its first pod starts.
- **Concurrency:** kysely's `Migrator` takes a session-level advisory lock
  (`pg_advisory_lock`) for the whole run, so two pods starting together apply
  each migration once. A session lock needs a real session, so the migrate
  connection string must use Neon's **direct** endpoint, not the `-pooler`
  one (PgBouncer in transaction mode does not keep a session's locks).
- **Failure:** with the default rolling update (maxUnavailable floors to 0 at
  1–2 replicas), a failed migration leaves the new pod stuck in `Init` while
  the old pods keep serving. Each migration runs in its own transaction, so the
  database stays at the last one that succeeded.
- **Old pods during a rollout** keep serving against the migrated schema (the
  startup check only runs at boot). This was already true with manual
  migrations; additive migrations are safe, breaking ones need the usual
  expand/contract care.
- **Rollback consequence:** the startup check refuses a database *ahead* of the
  code, so rolling prod back to an older image after its migration has run
  leaves new pods refusing to boot until someone migrates down. Roll forward
  instead. (Unchanged in kind from today, but now the migration runs on every
  deploy rather than when someone remembers.)

## 4. Credentials

- New Secret Manager secrets `haruspex_staging_migrate_database_url` and
  `haruspex_prod_migrate_database_url` (infra repo: `secret_names`, plus
  accessor bindings for each environment's service account). Values: the
  `neondb_owner` connection string for that environment's Neon branch — the
  same role bifrost previews use (`migrateRole: neondb_owner`) — on the direct
  (non-pooler) host, for the advisory lock above.
- **Kept out of the app container** *(my call)*: the secret gets its own
  SecretProviderClass (`haruspex-{env}-migrate-secrets`) and its own CSI
  volume, mounted only by the initContainer, which reads `DATABASE_URL` from
  the synced Secret `haruspex-{env}-migrate-secrets`. Adding it to the existing
  SecretProviderClass would also have written it into the app container's
  `/mnt/secrets`.

## 5. Changes

**infra:** two names in `secret_names`; each added to its environment's
service-account list.

**haruspex `k8s/`:**

- `haruspex-base/deployment.yaml`: an `initContainers` entry `migrate` (same
  image placeholder as the app container, command
  `["node", "/app/migrate/index.js"]`, the app container's securityContext,
  small resource requests, the migrate volume at `/mnt/migrate`) and a
  `migrate-secrets` CSI volume.
- `haruspex-{env}/secret-provider-class-migrate.yaml` and its
  `kustomization.yaml` entry.
- `haruspex-{env}/deployment-patch.yaml`: the initContainer's `DATABASE_URL`
  from `haruspex-{env}-migrate-secrets`, and the volume's
  `secretProviderClass`.

**Tests** *(my call)*: a unit test over the manifests that pins the
properties a copy-paste or rename would break — the initContainer's image is
the app container's, its command is the runner, each environment reads its
*own* migrate secret, and the app container never mounts the migrate volume
or sees the owner secret. `yaml` becomes a dev dependency to parse them.

**Docs:** README's "The startup migration check" and "Applying migrations from
inside the image" say staging and prod now migrate on deploy; the manual
command stays documented for local databases.

## 6. Rollout order (manual steps the owner runs)

1. Merge the infra change and `pulumi up` (creates the two secrets and the
   bindings, empty).
2. Add each secret's value, the `neondb_owner` URL on the direct (non-pooler)
   host: `echo -n '<owner url>' | gcloud secrets versions add
   haruspex_{env}_migrate_database_url --data-file=-`.
3. Merge the Haruspex PR. ArgoCD syncs both environments' manifests; each new
   pod migrates (a no-op where the database is current) and starts.

Merging step 3 before step 2 is safe but noisy: the new pod cannot mount the
missing secret and stalls in `ContainerCreating` while the old pods serve.

## 7. Left to the builder

Resource requests for the initContainer; README wording.
