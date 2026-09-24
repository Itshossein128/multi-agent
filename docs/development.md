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
pnpm test --runInBand
pnpm --filter server build
pnpm --filter web build
pnpm --filter web test:e2e
```

E2E به سرویس‌های web/server و PostgreSQL نیاز دارد؛ نتیجه‌ی آن را جدا از unit/integration tests گزارش کنید.

## Credential Broker

کد broker در `src/broker/` است و هر دو سمت را دارد: سرویس مستقل (سرور) و client سرور اجرایی (`HttpCredentialGateway` در `src/security/credentialGateway.ts`).

اجرای محلی سرور broker در development (بدون mTLS؛ بدون `CREDENTIAL_BROKER_DATABASE_URL` از lease/audit in-memory استفاده می‌شود):

```bash
CREDENTIAL_BROKER_SERVICE_TOKENS=dev:local-dev-token \
CREDENTIAL_BROKER_PORT=8484 \
npx ts-node src/broker/server.ts
```

DDL جدول‌های lease و audit (نیازمند `CREDENTIAL_BROKER_DATABASE_URL`):

```bash
CREDENTIAL_BROKER_DATABASE_URL=postgresql://... node infrastructure/broker/migrate.cjs
```

نکات:

- در production سرور اجرایی بدون `CREDENTIAL_BROKER_URL`، `CREDENTIAL_BROKER_SERVICE_TOKEN`، mTLS و `CREDENTIAL_BROKER_FAIL_CLOSED=true` بالا نمی‌آید؛ هیچ fallback خاموشی به gateway process-local وجود ندارد.
- secretهای provider از Vault خوانده می‌شوند (`CREDENTIAL_BROKER_VAULT_URL` و `CREDENTIAL_BROKER_VAULT_TOKEN`)؛ مسیر هر secret `secret/<tenant>/<provider>/<alias>` است و ورودی مشترک فقط با policy صریح مجاز است.
- سرویس standalone بدون directory پیش‌فرض deny-all است؛ deployment باید `AuthorizationSource` و `QuotaUsageSource` خود را از طریق `startBroker(..., overrides)` وصل کند.
- فهرست کامل متغیرها در بلوک `CREDENTIAL_BROKER_*` فایل `.env.example` آمده است (اولویت `CREDENTIAL_BROKER_*` بر `TOOL_CREDENTIAL_GATEWAY_*`).
- تست‌های broker:

```bash
pnpm test --runInBand tests/brokerContract.test.ts tests/brokerService.test.ts tests/brokerHttp.test.ts tests/brokerSecurity.test.ts tests/brokerPersistence.test.ts
```

suiteهای PostgreSQL این تست‌ها فقط با `MEMORY_TEST_DATABASE_URL` فعال می‌شوند و هر اجرا schema ایزوله می‌سازد و در پایان حذف می‌کند؛ Vault در تست‌ها fake است و هیچ secret واقعی خوانده نمی‌شود.

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

ساخت و smoke test image در [cli-worker-image.md](cli-worker-image.md) آمده است. credential delivery سه مسیر دارد: دو adapter توسعه‌ای file و environment (پیش‌فرض هر دو خاموش) و مسیر credential broker. مسیرهای file/environment مرز production multi-tenant محسوب نمی‌شوند؛ در production از broker استفاده کنید: `CLI_CREDENTIAL_BROKER_ENABLED=true` با تحویل server-mediated که خودش در production فقط با `CREDENTIAL_BROKER_TRUSTED_SERVER_DELIVERY=true` مجاز است.

### agy local setup

Local execution mode (`CLI_WORKER_MODE=local`) is trusted-code only. Prompts use NDJSON stdin, and permissions are not auto-bypassed. Container agy requires a custom digest-pinned image without mounting host home. agy currently requires the proxy in this environment and returns HTTP 403 without it. The corresponding proxy variables must already exist in the server environment and must not contain URL credentials.

```env
CLI_AGENT_ENABLED=true
CLI_WORKER_MODE=local
CLI_AGENT_ALLOWED_EXECUTABLES=agy # or explicit absolute path, e.g. /usr/local/bin/agy
CLI_AGENT_WORKSPACE_ROOTS=/absolute/path/to/allowed/workspaces
WORKER_ALLOWED_ENV_KEYS=HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,NO_PROXY,http_proxy,https_proxy,all_proxy,no_proxy
```

### Cursor CLI (env API key)

The Cursor Agent CLI (`agent`) is installed in the default digest-pinned worker image, and can also be installed on the server host for local mode (`curl https://cursor.com/install -fsS | bash`). Authentication always uses the `CURSOR_API_KEY` environment variable delivered through the credential mechanism; browser login is never used.

Container mode (default worker image, Cursor included):

```env
CLI_AGENT_ENABLED=true
CLI_WORKER_MODE=container
CLI_WORKER_ALLOW_NETWORK=true
CLI_AGENT_ALLOWED_EXECUTABLES=codex,claude,agent
CLI_AGENT_WORKSPACE_ROOTS=/absolute/path/to/allowed/workspaces
CLI_WORKER_IMAGE=registry.example/worker@sha256:<digest>
CLI_CREDENTIAL_ENVIRONMENT_ENABLED=true
CLI_CURSOR_CREDENTIAL_ENV_VAR=CURSOR_API_KEY
CURSOR_API_KEY=cursor_...
```

Local mode (Cursor installed on the server host):

```env
CLI_AGENT_ENABLED=true
CLI_WORKER_MODE=local
CLI_AGENT_ALLOWED_EXECUTABLES=agent
CLI_AGENT_WORKSPACE_ROOTS=/absolute/path/to/allowed/workspaces
CLI_CREDENTIAL_ENVIRONMENT_ENABLED=true
CLI_CURSOR_CREDENTIAL_ENV_VAR=CURSOR_API_KEY
CURSOR_API_KEY=cursor_...
```

Create a Studio agent with backend `type: cli`, `provider: cursor` (executable defaults to `agent`). Allow `agent` in the agent's restricted `allowedCommands`, and set an absolute `workspaceRoot` under `CLI_AGENT_WORKSPACE_ROOTS`. The agent policy must also enable `network` for provider calls. Container runs add `--force`; local runs keep Cursor's approval model and only auto-add `-p`, `--output-format text`, and `--trust`.

Cursor CLI version pinning: Cursor does not publish checksums, so the worker image pins the exact artifact URL the official installer downloads (`https://downloads.cursor.com/lab/<version>/linux/x64/agent-cli-package.tar.gz`) and locks it with a recorded SHA-256 digest that BuildKit verifies on every build. Bump the version and its checksum together in `infrastructure/docker/worker.Dockerfile`. The CLI tries to auto-update at runtime by default, but the worker's read-only root filesystem and non-writable installation paths prevent mutation; the image stays reproducible for the pinned artifact.

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
