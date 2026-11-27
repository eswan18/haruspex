# Deploy-Time Migrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staging and prod deploys migrate their database before the app starts, using the image's own runner and the owner role, with no manual step.

**Architecture:** An initContainer `migrate` on the Haruspex Deployment runs `node /app/migrate/index.js` with `DATABASE_URL` from a separate, initContainer-only Secret (`haruspex-{env}-migrate-secrets`) backed by new Secret Manager secrets `haruspex_{env}_migrate_database_url`.

**Tech Stack:** Kustomize overlays, Secrets Store CSI driver (GCP provider), Pulumi (infra repo), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-26-deploy-time-migrations-design.md`

## Global Constraints

- Names: initContainer `migrate`; volume `migrate-secrets` mounted at `/mnt/migrate`; SecretProviderClass and synced Secret both `haruspex-{env}-migrate-secrets`; Secret key and object `DATABASE_URL`; Secret Manager secret `haruspex_{env}_migrate_database_url`.
- The initContainer image line is byte-identical to the app container's (`us-central1-docker.pkg.dev/ethans-services/containers/haruspex:override-required`), so ArgoCD's kustomize override replaces both.
- Command exactly `["node", "/app/migrate/index.js"]`.
- The app container never mounts `migrate-secrets` and never references the migrate Secret.
- Owner credential values are never handled by the agent: the owner adds them with `gcloud`.

## Review Focus

1. A staging overlay that reads prod's migrate secret (or vice versa) after a copy-paste — Task 1's test pins each environment to its own names.
2. The kustomize image override missing the initContainer — Task 1 renders each overlay with an `images:` override and checks both containers.
3. The owner URL reaching the app container through `/mnt/secrets` — Task 1's test checks the app SecretProviderClass and the app container's mounts.
4. Merging the manifests before the secrets have values — documented rollout order in the PR (pods stall, old pods serve).

---

### Task 1: Manifests and their invariants

**Files:**
- Create: `k8s/haruspex-staging/secret-provider-class-migrate.yaml`, `k8s/haruspex-prod/secret-provider-class-migrate.yaml`, `k8s/manifests.test.ts`
- Modify: `k8s/haruspex-base/deployment.yaml`, `k8s/haruspex-{staging,prod}/deployment-patch.yaml`, `k8s/haruspex-{staging,prod}/kustomization.yaml`, `package.json` (dev dependency `yaml`)

- [ ] **Step 1: Write the failing test** `k8s/manifests.test.ts` (parse with `yaml`'s `parseAllDocuments`/`parse`), for each env in `["staging", "prod"]` plus the base:
  - `the migrate initContainer runs the image's runner with the app's image`: base `initContainers` has one entry named `migrate`; its `image` equals the app container's; `command` equals `["node", "/app/migrate/index.js"]`; it mounts `migrate-secrets` at `/mnt/migrate` read-only; its `securityContext` equals the app container's.
  - `<env> reads its own migrate secret`: patch's `migrate` initContainer env `DATABASE_URL` → `secretKeyRef { name: "haruspex-<env>-migrate-secrets", key: "DATABASE_URL" }`; patch volume `migrate-secrets` has `volumeAttributes.secretProviderClass: "haruspex-<env>-migrate-secrets"`; `secret-provider-class-migrate.yaml` has `metadata.name`/`namespace` `haruspex-<env>-migrate-secrets`/`haruspex-<env>`, one secret `projects/ethans-services/secrets/haruspex_<env>_migrate_database_url/versions/latest` at path `DATABASE_URL`, synced to `secretObjects[0].secretName: haruspex-<env>-migrate-secrets`; kustomization `resources` includes the file.
  - `the app container never sees the owner credential`: in base and each patch, the `haruspex` container's `volumeMounts` and `env` mention neither `migrate-secrets` nor `haruspex-<env>-migrate-secrets`; the app SecretProviderClass (`secret-provider-class.yaml`) contains no `migrate_database_url`.
- [ ] **Step 2: Run** `npx vitest run k8s/manifests.test.ts` — Expected: FAIL (no initContainer).
- [ ] **Step 3: Implement the manifests** per the Global Constraints. initContainer resources: requests `memory: 64Mi`, `cpu: 5m`. Comment in the base explaining: same image so the build migrates to its own schema; owner credential on its own volume so the app container never holds it; exit-code contract (README).
- [ ] **Step 4: Run** the test — PASS. Then render both overlays with an image override and check the initContainer got it:
  `kubectl kustomize` on a temp overlay (in the scratchpad) that references `k8s/haruspex-<env>` and sets `images: [{name: us-central1-docker.pkg.dev/ethans-services/containers/haruspex, newTag: abc123}]` — Expected: both `haruspex` and `migrate` show `:abc123`; the rendered pod spec has the `migrate-secrets` volume only in the initContainer's mounts.
- [ ] **Step 5: Commit** — "Run migrations in an initContainer on deploy".

### Task 2: Docs

**Files:** Modify `README.md` ("The startup migration check", "Applying migrations from inside the image"), `CLAUDE.md` if it mentions running migrations manually for deployed environments.

- [ ] Say staging and prod now migrate on deploy via the `migrate` initContainer with the owner role from `haruspex_{env}_migrate_database_url` (direct, non-pooler Neon host — the runner holds a session advisory lock); the manual command remains for local databases; rollback note (database ahead → refuse to boot; roll forward). Commit.

### Task 3: infra secrets (separate repo: `~/Develop/ibormeith/infra`)

**Files:** Modify `infra/__main__.py`: add `haruspex_prod_migrate_database_url` and `haruspex_staging_migrate_database_url` to `secret_names` (haruspex blocks) and to the `haruspex-prod` / `haruspex-staging` service-account lists.

- [ ] Edit, then verify with `python -c "import ast; ast.parse(open('__main__.py').read())"` and whatever lint the infra repo runs (`ruff`/`make` if present). Commit on a branch; open a PR. `pulumi up` and secret values are the owner's steps (spec §6).

### Task 4: Verify and open the Haruspex PR

- [ ] `npm run lint`, `npx tsc --noEmit`, full container suite, `npm run build`. Push, open the PR with the rollout order (spec §6) at the top, linking the infra PR.
