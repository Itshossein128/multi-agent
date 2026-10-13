# US5 Independent Test Verification — Clean Start Without Legacy Tenants

Scope: `specs/007-organization-tenancy-audit`, US5 (Phase 3 MVP) T019–T024 and Convergence task T098 (F23 / HIGH).
Executed on: 2026-10-12 / 2026-10-13 against host PostgreSQL 16 on `127.0.0.1:55432` (`MEMORY_TEST_DATABASE_URL`).
Target: Disposable isolated schema and isolated filesystem workspace storage root.
The developer's application database was not reset or modified.

## Delivered behavior and verified invariants

1. **Unconfirmed reset protection (FR-108, AC1)**:
   - When `resetApplicationData` is called without `--confirm-destroy-all-data` (`confirm: false`), execution halts and throws immediately.
   - Verified: All pre-reset application tables (`studio_users`, `studio_organizations`, `studio_projects`, `studio_tasks`, `studio_workflows`, `studio_tools`, `studio_agents`) and filesystem working copies remain 100% intact.

2. **Legacy-data migration refusal (FR-108, SC-002, AC2)**:
   - When legacy tenant-owned rows exist prior to `studio_organization_memberships`, attempting to execute `018_organization_foundation.sql` fails closed:
     `Migration 018 refused: 7 legacy organization-owned row(s) exist before studio_organization_memberships. Run pnpm db:reset -- --confirm-destroy-all-data first.`
   - No schema or membership migration can proceed over unpurged legacy data.

3. **Confirmed reset execution (FR-108, SC-002, AC3)**:
   - With explicit `--confirm-destroy-all-data` (`confirm: true`), `resetApplicationData` truncates all 26 listed studio data tables and purges workspace filesystem storage.
   - Migration ledger (`studio_migrations`) is preserved untouched.

4. **Post-reset migration progression**:
   - On clean state, migrations `018_organization_foundation.sql` through `023_rls_prerequisites_complete.sql` apply cleanly without error.

5. **Clean registration and first organization onboarding (FR-108, SC-002, AC3)**:
   - Registration creates a user row with `tenant_id = NULL` (no implicit private tenant).
   - Calling `OrganizationProfileService.create` creates the organization record, lowercase unique slug, exactly one active `owner` membership (`version: 1`), and an append-only audit record in `studio_organization_audit`.
   - The user's default `tenant_id` pointer is bound to the newly created organization.
   - Zero pre-reset legacy records are visible or accessible anywhere.

## Verification commands and transcript

- **Independent test runner**:
  ```bash
  MEMORY_TEST_DATABASE_URL="postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory" \
    node -r dotenv/config ./node_modules/ts-node/dist/bin.js --transpile-only scripts/us5-independent-test.ts
  ```
- **Execution transcript**: Retained in [us5-independent-test.txt](./us5-independent-test.txt).
- **Unit test acceptance suites**:
  ```bash
  MEMORY_TEST_DATABASE_URL="postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory" \
    npx jest tests/dbReset.test.ts tests/organizationOnboardingAfterReset.test.ts
  ```
  Result: 2 suites, 6 tests passed, zero failed.
