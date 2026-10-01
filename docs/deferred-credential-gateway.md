# Credential Broker — معماری و وضعیت اجرا

**وضعیت: کد broker (سرور + client) پیاده‌سازی و تست شده؛ استقرار broker واقعی، Vault و گواهی mTLS هنوز deployment prerequisite است.**

## جریان lease

```text
Execution Server                 Credential Broker (سرویس مستقل)          Secret Store
──────────────────               ──────────────────────────────────       ────────────
credentialGatewayFromEnvironment
  └─ HttpCredentialGateway
        │ POST /v1/leases          policy (deny-by-default):
        │  + Idempotency-Key ────▶ فعال بودن tenant، عضویت principal/run،
        │◀── leaseId + TTL ─────── agent→provider، alias ابزار، quota/budget
        │                          و rate limit
        │ POST /v1/leases/:id/consume
        │  context (tenant/     ─▶ UPDATE شرطی اتمیک (تک‌مصرف) ──read──▶ Vault KV v2
        │◀─ principal/run) ───── secret فقط یک‌بار              ◀──────  (dev: in-memory)
        │
        │ POST /v1/leases/:id/revoke ─▶ status=revoked (idempotent)
        └─ GET /v1/audit/leases ──▶ audit hash chain، append-only (برای operator/audit)
```

## اجزای پیاده‌سازی‌شده

- `src/broker/` — قرارداد v1 (اعتبارسنجی lease/consume/revoke و boundsهای TTL/alias/provider/purpose)، سرویس (issue با idempotency، consume اتمیک، revoke idempotent)، policy پیش‌فرض deny، rate limit (issue/مصرف/lease فعال per tenant و شمارش **شکست** consume per lease)، storeهای lease (PostgreSQL با UPDATE شرطی اتمیک + in-memory)، audit با hash chain و trigger append-only، secret store (Vault KV v2 + in-memory برای dev)، app HTTP، پیکربندی fail-closed و composition سرور با mTLS.
- `src/security/credentialGateway.ts` — `HttpCredentialGateway` (timeout، retry با Idempotency-Key، `revoke()`، mTLS از طریق undici Agent، خطای `CredentialGatewayError` با کد ماشینی) و `EnvironmentCredentialGateway` فقط برای development. انتخاب gateway در production بدون broker شکست می‌خورد؛ هیچ fallback خاموشی وجود ندارد.
- `src/security/providerCredentials.ts` — resolver کلید API اجاره‌ای برای agentهای backend API.
- `src/agents/runtime/workerCredentials.ts` — `BrokerWorkerCredentialResolver` برای credential مربوط به worker؛ در production فقط با `CREDENTIAL_BROKER_TRUSTED_SERVER_DELIVERY=true`.
- `apps/server/src/composition.ts` — اتصال composition root سرور اجرایی به broker و بستن آن هنگام shutdown.
- `infrastructure/broker/migrate.cjs` — DDL جدول‌های lease و audit و ایندکس‌های لازم.

## رفتار fail-closed

- در production سرور اجرایی بدون `CREDENTIAL_BROKER_URL`، `CREDENTIAL_BROKER_SERVICE_TOKEN`، mTLS (`CREDENTIAL_BROKER_REQUIRE_MTLS=true` به‌همراه فایل‌های CA/cert/key) و `CREDENTIAL_BROKER_FAIL_CLOSED=true` بالا نمی‌آید.
- هر خطای broker (timeout، 5xx، پاسخ نامعتبر یا ناسازگار) به `CredentialGatewayError` تبدیل می‌شود و اجرای ابزار/agent متوقف می‌شود؛ secret هرگز در log، trace، event، audit، AgentRecord یا ToolRecord ظاهر نمی‌شود.
- در development بدون URL، `EnvironmentCredentialGateway` (پیش‌فرض خاموش با `TOOL_CREDENTIAL_GATEWAY_ENABLED=false`) انتخاب می‌شود.
- سرویس standalone بدون directory پیش‌فرض deny-all است؛ deployment باید فهرست هویت خود را از طریق `AuthorizationSource`/`QuotaUsageSource` وصل کند.

## ریسک باقی‌مانده

اگر worker یا dependency آن compromise شود، secretی که برای همان run تحویل شده ممکن است قابل استفاده باشد. Docker نیز به‌تنهایی معادل VM یا sandbox قوی نیست و به daemon و policy میزبان وابسته است. علاوه بر آن:

- mTLS و Vault واقعی و E2E قطع شبکه/revocation فقط با broker واقعی در محیط deployment قابل اثبات هستند (تست‌ها از fake استفاده می‌کنند و هیچ secret واقعی در این workspace ثبت نشده است).
- rate limitها و شمارنده‌ها process-local هستند؛ broker چندنمونه‌ای به store مشترک (مثلاً PostgreSQL یا Redis) نیاز دارد.
- تحویل credential به worker فعلاً server-mediated است؛ مصرف مستقیم lease توسط worker (worker-direct) هدف آینده است.
- متد `rotate` در قرارداد secret store وجود دارد اما rotation خودکار credentialهای provider هنوز پیاده نشده است.

## شرط production

1. استقرار مستقل broker (`node dist/broker/server.js`) با DDL از `infrastructure/broker/migrate.cjs` و وصل کردن `AuthorizationSource` به فهرست هویت deployment.
2. انتقال secretهای `TOOL_*` از env سرور اجرایی به Vault با مسیر `secret/<tenant>/<provider>/<alias>`؛ ورودی `_shared` فقط با policy صریح (`sharedPolicy`).
3. صدور گواهی mTLS و پیکربندی `CREDENTIAL_BROKER_SERVICE_TOKENS` چرخش‌پذیر به‌صورت `نام:token:scope`.
4. اجرای live rotation/revoke/audit و failure-injection (قطع broker، انقضای lease، revoke) در محیط deployment.
5. تا آن زمان در development هم `TOOL_CREDENTIAL_GATEWAY_ENABLED` را پیش‌فرض خاموش نگه دارید و worker container را digest-pinned کنید.
