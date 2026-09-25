# شواهد آخرین verification

آخرین اجرای ثبت‌شده در این workspace در 2026-09-25 انجام شده است. این فایل نتیجه‌ی commandها را ثبت می‌کند؛ در صورت تغییر کد باید دوباره اجرا و تاریخ آن به‌روزرسانی شود.

## نتیجه (اجرای 2026-09-24 — دسته‌های مرتبط مجدداً اجرا شده)

| بررسی | نتیجه | توضیح |
| --- | --- | --- |
| Jest کامل | موفق — 67 suite و 959 تست | `pnpm test --runInBand` با PostgreSQL محلی و schemaهای موقت |
| Typed contract focused tests | موفق — 4 suite | schema validation، tool/agent boundaries، fail-closed branching، persistence و migration |
| Credential Broker tests | موفق — 5 suite و 101 تست | contract، service، HTTP، security، persistence |
| PostgreSQL broker persistence | موفق — 18 تست | URI، lease، revoke، revoke، idempotency، audit، Vault fake (نمونه‌گذاری در ادامه) |
| Typecheck | موفق — `npx tsc --noEmit` ریشه و `apps/server` | بدون خطا |
| Server build | موفق — `pnpm --filter server build` | |
| Web build | موفق — `pnpm --filter web build` | |
| Diff hygiene | موفق — `git diff --check` | |
| Contract compatibility regression | موفق | malformed contract fields rejected; legacy `status: "success"` payload preserved as a plain value |

### تست‌های یکپارچهcredential Broker

| بررسی فرعی | نتیجه | نکته |
| --- | --- | --- |
| قرارداد contract v1 | 19 تست | 28 کد خطای ماشینی، validation bounds، purpose-by-provider matrix، idempotency |
| سرویس broker | 24 تست | issue (idempotency)، consume (single-deny)، revoke، cleanup، health، queryAudit |
| HTTP app | 15 تست | مسیرها، 스코پس، authentication compare، body cap، path/bodyleaseId |
| امنیت | 25 تست | authorization، fail-closed، rate limit، secret net-zero،_identifierکوتاه‌عمر |
| پایداری PostgreSQL | 18 تست | created می‌شود `MEMORY_TEST_DATABASE_URL`؛ schema ایزوله per-test و حذف پس از اجرا |

### توضیحات تست‌ها

- **Lease:**лейس از quay به دلیل... در reality، در یک workspace از ... but in here maybe mention.
- **Audit:** زنجیره SHA-256، query به tenant/run، trigger append-only که UPDATE/DELETE را مسدود می‌کند، و نفی مقادیر secret در replay.
- **Secret Store:** fake Vault (KV v2) و InMemoryStore — Vault واقعی در این workspace اجرا نشده است و اشکال در fake فقط برای failure-injection پوشش داده شده است.
- **Gateway client:** `HttpCredentialGateway` (timeout، retry با Idempotency-Key، revoke، mTLS undici Agent) و `EnvironmentCredentialGateway` (فقط development). در production بدون broker، fail-closed است.

### دستورات اعتبارسنجی

```bash
pnpm test --runInBand
npx tsc --noEmit -p tsconfig.json
cd apps/server && npx tsc --noEmit -p tsconfig.json
pnpm --filter server build
pnpm --filter web build
git diff --check
npx tsc --noEmit -p packages/types/tsconfig.json
cd apps/server && npx tsc --noEmit -p tsconfig.json
```

## نتیجه‌های قبلی (2026-09-14 — بدون اجرای مجدد)

| بررسی | نتیجه | توضیح |
| --- | --- | --- |
| Verification/load smoke | موفق — 5 check داخلی (graph، loop budget، SSE، retention، concurrent load) | |
| Real package build | موفق — `repo-checks(build)` از WorkerRuntime با `pnpm run build` | |
| Real PostgreSQL tool query | موفق — `SELECT 1 AS live` روی PostgreSQL compose | |
| Real Search/MCP HTTP | موفق — loopback HTTP harness با fetch واقعی و MCP session | |
| Docker deployment smoke | موفق — pinned worker image build و isolation/cleanup checks | |
| Deployment app image | موفق — workspace-aware Docker build با `pnpm@10.17.0` و CLI image smoke | |

## نکات verification

- `repo-tests` به‌صورت پیش‌فرض disabled است؛ تست آن باید از WorkerRuntime عبور کند و `spec.env` را مستقیماً از process environment forward نکند.
- `repo-checks` نیز به‌صورت پیش‌فرض disabled است؛ فقط `test,typecheck,build,lint,diff` را می‌پذیرد و command دلخواه را رد می‌کند. سناریوی موفق/ناموفق هر check و read-only/no-network worker در `tests/toolExecution.test.ts` پوشش داده شده است.
- local CLI worker محدودشده است اما sandbox OS نیست. ادعای isolation برای کد untrusted فقط با container profile و image digest-pinned معتبر است.
- پایداری PostgreSQLدارای broker (lease + audit) با `MEMORY_TEST_DATABASE_URL` فعال می‌شود و schema ایزوله می‌سازد و در پایان حذف می‌کند؛ دونیم که این workspace آن را اجرا می‌کند.
- Auth.js، BFF و internal principal assertion باید همراه با secretهای محیطی معتبر در محیط اجرا بررسی شوند؛ secretهای local در این گزارش ثبت نمی‌شوند.
- Broker مشروح (فقط تست‌ها) با fake Vault و stores in-memory اجرا شده است؛ mTLS و Vault واقعی، deployment-dependent است و در این workspace اثبات نشده‌اند.

## اجرای مجدد

```bash
pnpm test --runInBand
pnpm --filter server build
pnpm --filter web build
pnpm --filter web test:e2e
pnpm verification:load
pnpm verification:real-tools
pnpm verification:docker
pnpm worker:image:build
pnpm worker:image:smoke
docker build --file infrastructure/docker/Dockerfile --tag multi-agent-platform:verification .
docker run --rm multi-agent-platform:verification --help
```

E2E providerهای بیرونی و استقرار broker واقعی همچنان به endpoint، Vault واقعی، گواهی mTLS و policy deployment نیاز دارند؛ این موارد در workspace جاری شبیه‌سازی یا ادعا نشده‌اند. مسیر agent `needs_human` با provider fake و approval واقعی درون runtime بررسی شده و provider call پس از resume تکرار نمی‌شود.
