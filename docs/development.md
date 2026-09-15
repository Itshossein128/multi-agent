# توسعه و اجرای محلی

## پیش‌نیاز

- Node.js 20 یا جدیدتر
- pnpm `10.17.0`
- Docker برای PostgreSQL و در صورت نیاز CLI worker

وابستگی‌های سرور از `apps/server/.env` و وابستگی‌های وب از `apps/web/.env.local` خوانده می‌شوند. secretهای واقعی را commit نکنید.

## اجرای معمول

```bash
pnpm install --frozen-lockfile
pnpm db:dev:up
pnpm db:migrate
pnpm dev
```

برای اجرای جداگانه:

```bash
pnpm dev:web
pnpm dev:server
```

`MEMORY_DATABASE_URL` به دیتابیس ایزوله‌ی Studio اشاره می‌کند و `STUDIO_STORE=postgres` persistence را فعال می‌کند. migrationها با `pnpm db:migrate` و خارج از startup اجرا می‌شوند. در production، storage volatile نباید فعال باشد.

## Verification

```bash
pnpm test -- --runInBand
pnpm --filter server build
pnpm --filter web build
pnpm --filter web test:e2e
```

E2E به سرویس‌های web/server و PostgreSQL نیاز دارد؛ نتیجه‌ی آن را جدا از unit/integration tests گزارش کنید.

## Guardrailهای سرور

سرور قبل از ساخت run، workflow را validate و سپس ownership، agent/tool registry و execution policy را اعمال می‌کند. limits مهم از environment خوانده می‌شوند:

- graph: `WORKFLOW_MAX_NODES`, `WORKFLOW_MAX_EDGES`, `WORKFLOW_MAX_BRANCHES`
- execution: `WORKFLOW_RECURSION_LIMIT`, `WORKFLOW_MAX_STEPS`, `RUN_MAX_DURATION_MS`
- concurrency/retry: `WORKFLOW_MAX_CONCURRENT_BRANCHES`, `NODE_RETRY_MAX_ATTEMPTS`, `NODE_RETRY_MAX_BACKOFF_MS`
- payloads: `RUN_MAX_EVENTS`, `RUN_EVENT_MAX_PAYLOAD_BYTES`, `RUN_MAX_PAYLOAD_BYTES`, `AGENT_MAX_OUTPUT_BYTES`, `TOOL_MAX_OUTPUT_BYTES`

eventها و telemetry قبل از persistence یا ارسال بیرونی redacted و bounded می‌شوند. credential را در workflow، agent، tool یا run input قرار ندهید.

## احراز هویت و BFF

در web، Auth.js session هویت را تعیین می‌کند. درخواست‌های execution از `/api/execution` عبور می‌کنند؛ BFF assertion داخلی امضاشده می‌سازد و browser نمی‌تواند `userId`، `tenantId` یا header هویتی دلخواه را تزریق کند. سرور assertion را verify و در نبود آن درخواست را رد می‌کند.

## CLI worker

`CLI_WORKER_MODE=local` فقط برای کد trusted است. برای کد untrusted:

```env
CLI_WORKER_MODE=container
CLI_WORKER_IMAGE=registry.example/worker@sha256:<digest>
```

ساخت و smoke test image در [cli-worker-image.md](cli-worker-image.md) آمده است. credential delivery دو adapter توسعه‌ای دارد و پیش‌فرض هر دو خاموش است؛ این adapterها مرز production multi-tenant محسوب نمی‌شوند.

### Separate developer vs agent Codex accounts

Keep account A in `~/.codex` for local development. Login account B into an isolated home that workers read:

```bash
pnpm credentials:login-codex
```

Then set server env (typically `apps/server/.env`) to that file only:

```env
CLI_WORKER_MODE=container
CLI_WORKER_ALLOW_NETWORK=true
CLI_CREDENTIAL_FILE_ENABLED=true
CLI_CODEX_AUTH_FILE=<repo>/.local/agent-credentials/codex/auth.json
CLI_CREDENTIAL_ENVIRONMENT_ENABLED=false
```

Do not omit `CLI_CODEX_AUTH_FILE` if you want isolation; the default is `~/.codex/auth.json` and would share account A. Token refresh writeback targets only the configured path.

## ابزارها

function پیش‌فرض data-only است. `repo-tests` و `repo-checks` خاموش هستند و فقط با `WorkerRuntime` اجرا می‌شوند؛ local trusted-only و container حالت پیشنهادی است. `repo-checks` فقط checkهای ثابت `test,typecheck,build,lint,diff` را می‌پذیرد و command دلخواه اجرا نمی‌کند. categoryهای پشتیبانی‌نشده باید fail-closed بمانند. جزئیات در [phase-6-tools.md](phase-6-tools.md) است.

برای smoke/load verification داخلی:

```bash
pnpm verification:load
```

این harness graph compilation، loop budget، چند subscriber هم‌زمان SSE، event retention و بار چند run را بررسی می‌کند. اجرای سناریوی Docker به image digest-pinned و Docker daemon محیط deployment نیاز دارد.
