# Critical repairs T081–T083

Verified 2026-10-12. User-selected scope: the three critical convergence repairs only.
The commit also includes the previously uncommitted US1/US2 work at the user's explicit request.

## Behavior

- T081: both studio adapters reject foreign-ID writes and import collisions without partial batches. PostgreSQL uses conditional upserts, including internal calls without a principal; imports are transactional. In-memory imports stage changes and report losing concurrent conflicts as uniform access denial. Tests cover all ten save methods, personal/system import collisions, and real PostgreSQL races.
- T082: shadow mode evaluates authorization for diagnostics and returns 503 before any scoped handler. Removal, suspension, account disablement, configuration downgrade and a new router cannot restore weaker serving. Enforce mode retains valid access and immediate revocation.
- T083: service-boundary checks require `credentials.manage` for credential-bearing creates, updates, clearing, duplication, imports and deletion. Owner/admin operations succeed; member/viewer denials leave records unchanged in both adapters. Credential-free member CRUD remains available. Valid bounded credential aliases are accepted while raw secrets remain rejected; tool creation preserves its submitted connection configuration.

## Executed TDD evidence

| Evidence | Observed result |
| --- | --- |
| `t081-red.txt` | 19 failed, 19 passed |
| `t081-import-race-red.txt` | 1 failed, 1 passed (38 filtered) |
| `t081-internal-red.txt` | 13 failed, 7 passed (40 filtered) |
| `t082-red.txt` | 3 failed, 2 passed |
| `t083-red.txt` | 32 failed, 84 passed |
| `targeted-final.txt` | 4 suites, 183 passed, no skips |
| `full.txt`, `full-report.json` | 129 suites, 2346 passed, no skips, 86.91 seconds |

The earlier individual green logs are intermediate snapshots. `t082-compile-attempt.txt` is a compile error, not behavioral red evidence. `full-incomplete-attempt.txt` is an interrupted preliminary run and is excluded from completion evidence.

Final focused command:

```sh
MEMORY_TEST_DATABASE_URL=postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory pnpm test --runInBand tests/organizationWriteIsolation.test.ts tests/organizationCredentialMutations.test.ts tests/organizationShadowSafety.test.ts tests/organizationShadowGate.test.ts
```

Final full command:

```sh
MEMORY_TEST_DATABASE_URL=postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory pnpm test --runInBand --json --outputFile=specs/007-organization-tenancy-audit/evidence/critical-repairs/full-report.json
```

Root/server/web/test TypeScript checks and types/server/web builds exited successfully; output is retained in the corresponding `typecheck-*.txt` and `*-build.txt` files. Successful typechecks produce empty output. `git diff --check` passed. Requirements checklist remains read-only (16/16 checked); `.specify/extensions.yml` is absent, so no before/after hooks apply. PowerShell prerequisites were unavailable; the feature pointer and required artifact paths were verified directly.

## Evidence limits and remaining work

The targeted suites exercise actual HTTP middleware/services and both adapters, including real PostgreSQL temporary schemas. Legacy domain suites use an explicit Jest-only organization-boundary mock because they predate account/membership fixtures; enforcement suites and shadow-safety suites use the actual middleware. The mock does not exist in application builds.

No new browser run, production deployment, live Vault/mTLS verification or RLS activation is claimed by this pass. Earlier US1/US2 browser evidence remains in its original directories. T084–T103 and later-story obligations remain open, including shared-resource ownership capture, database context/RLS, organization memory and deletion. Existing activation gates remain unchanged.

`source-manifest.sha256` records changed implementation/test source; `SHA256SUMS` records this evidence directory excluding itself.

Captured text logs have trailing whitespace and extra trailing blank lines normalized for Git review; test outcomes and diagnostics are unchanged.
