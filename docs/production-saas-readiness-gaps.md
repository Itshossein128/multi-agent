# فهرست نیازمندی‌های محصول Production و SaaS

این سند فهرست قابلیت‌ها و زیرساخت‌هایی است که برای تبدیل Multi-Agent Studio به یک محصول بالغ، production-ready و SaaS چندمستاجری لازم هستند، اما در وضعیت فعلی یا پیاده‌سازی نشده‌اند، یا ناقص‌اند، یا هنوز با شواهد اجرایی کافی تأیید نشده‌اند.

## راهنمای وضعیت

- **پیاده نشده:** در کد یا مستندات فعلی وجود ندارد.
- **ناقص:** بخشی از قابلیت وجود دارد، اما برای production کافی نیست.
- **اثبات‌نشده:** احتمالاً بخشی از آن پیاده شده، اما با deployment، provider یا failure واقعی تأیید نشده است.

## P0 — Blockerهای production

### Credential و secret management

- [ ] Credential Broker خارجی واقعی
- [ ] mTLS بین execution server و broker
- [ ] token کوتاه‌عمر محدود به tenant، run و provider
- [ ] rotation خودکار credentialها
- [ ] revoke فوری credential
- [ ] audit کامل دسترسی به credential
- [ ] rate limit برای مصرف credential
- [ ] اتصال به Vault، KMS یا Secrets Manager
- [ ] حذف secretهای provider از environment دائمی process
- [ ] رمزنگاری secretها در حالت ذخیره و انتقال
- [ ] failure-injection برای قطع broker، انقضای token و revoke
- [ ] جلوگیری از نشت secret در log، trace، event، Docker metadata و crash dump

در وضعیت فعلی، gateway عمدتاً process-local و مناسب development/trusted deployment است، نه SaaS چندمستاجری.

### اجرای واقعی providerها

- [ ] canary واقعی برای OpenAI
- [ ] canary واقعی برای Anthropic
- [ ] canary واقعی برای Gemini
- [ ] canary واقعی برای Codex
- [ ] canary واقعی برای Claude Code
- [ ] canary واقعی برای agy
- [ ] canary واقعی برای Cursor
- [ ] تست quota، rate limit و timeout هر provider
- [ ] تست قطعی شبکه و outage provider
- [ ] مدیریت تفاوت capability مدل‌ها
- [ ] provider fallback یا routing policy
- [ ] خطای قابل‌فهم برای provider unavailable
- [ ] ثبت usage و cost واقعی به تفکیک run، agent، tenant و provider
- [ ] سقف هزینه برای run و tenant

اجرای providerهای پولی و واقعی تاکنون عمداً به‌صورت کامل انجام نشده و باید در deployment مقصد تأیید شود.

### اجرای توزیع‌شده

- [ ] queue واقعی برای runها
- [ ] worker pool مستقل از web/API process
- [ ] distributed scheduler
- [ ] اجرای چند instance از execution server
- [ ] distributed locking برای جلوگیری از اجرای دوباره
- [ ] idempotency سراسری بین instanceها
- [ ] heartbeat برای workerهای فعال
- [ ] تشخیص worker مرده
- [ ] requeue امن runهای نیمه‌کاره
- [ ] backpressure
- [ ] محدودیت concurrency در سطح tenant و organization
- [ ] priority queue
- [ ] graceful drain هنگام deploy
- [ ] autoscaling workerها
- [ ] dead-letter queue
- [ ] اجرای طولانی‌مدت بدون وابستگی به process memory

worker فعال، SSE listener، timer و بخشی از execution state هنوز process-local هستند. restart فقط برخی approvalهای قابل‌بازیابی را restore می‌کند.

### Backup و disaster recovery

- [ ] backup زمان‌بندی‌شده‌ی PostgreSQL
- [ ] point-in-time recovery
- [ ] backup رمزنگاری‌شده
- [ ] نگهداری backup خارج از همان host
- [ ] تست واقعی restore
- [ ] تعریف RPO
- [ ] تعریف RTO
- [ ] runbook خرابی database
- [ ] runbook خرابی worker
- [ ] runbook migration failure
- [ ] migration rollback strategy
- [ ] disaster recovery drill
- [ ] backup و restore workflow، agent، tool و run history

### امنیت runtime و اجرای کد

- [ ] image scanning برای Docker worker
- [ ] SBOM برای image
- [ ] امضای image و verification پیش از اجرا
- [ ] CVE scanning در CI
- [ ] image rotation و patch policy
- [ ] seccomp profile
- [ ] AppArmor یا SELinux profile
- [ ] محدودیت syscallها
- [ ] rootless container یا sandbox قوی‌تر
- [ ] محدودیت network egress و DNS
- [ ] محدودیت CPU، memory، disk و process
- [ ] جلوگیری از fork bomb
- [ ] cleanup تضمین‌شده‌ی workspace
- [ ] ephemeral filesystem واقعی
- [ ] تست escape از container
- [ ] تست path traversal، symlink و mount در deployment واقعی
- [ ] جداسازی کامل credential tenantها
- [ ] عدم اتکا به local worker برای repository غیرقابل‌اعتماد

## P1 — SaaS چندمستاجری

### Tenant و organization management

- [ ] مدل کامل organization
- [ ] چند organization برای یک user
- [ ] invitation و accept/reject invitation
- [ ] حذف member
- [ ] انتقال مالکیت
- [ ] suspend کردن member
- [ ] roleهای owner، admin، editor، runner و viewer
- [ ] RBAC در UI، API، workflow، agent، tool، memory و run
- [ ] permission inheritance
- [ ] project-level permissions
- [ ] environment-level permissions
- [ ] service account
- [ ] API key اختصاصی tenant
- [ ] rotation و revoke API key
- [ ] محدودیت IP یا network برای tenant
- [ ] tenant settings
- [ ] tenant usage dashboard
- [ ] tenant audit trail

Auth و tenant isolation وجود دارند، اما مدل کامل organization، invitation و RBAC سازمانی در سطح محصول SaaS هنوز کامل نیست.

### Billing و commercial SaaS

- [ ] subscription planهای Free، Pro، Team و Enterprise
- [ ] usage-based billing
- [ ] محاسبه‌ی token، run، worker و storage
- [ ] quota enforcement
- [ ] hard limit و soft limit
- [ ] overage policy
- [ ] trial
- [ ] coupon و discount
- [ ] invoice
- [ ] پرداخت و تمدید خودکار
- [ ] لغو subscription
- [ ] grace period
- [ ] payment failure handling
- [ ] payment webhook
- [ ] refund
- [ ] tax/VAT
- [ ] currency و timezone
- [ ] billing admin
- [ ] usage export
- [ ] جلوگیری از run بعد از عبور از quota
- [ ] cost attribution به tenant
- [ ] جلوگیری از cost abuse و infinite spend

### Data governance و privacy

- [ ] export کامل داده‌ی tenant
- [ ] حذف کامل حساب
- [ ] حذف tenant و داده‌های وابسته
- [ ] retention قابل تنظیم برای memory، run، event، trace و log
- [ ] deletion certificate
- [ ] Data Subject Request workflow
- [ ] GDPR/CCPA readiness در صورت هدف‌گذاری بازار مربوط
- [ ] data residency
- [ ] طبقه‌بندی داده‌های حساس
- [ ] حذف PII و secret از memory
- [ ] opt-out از memory
- [ ] حذف memory از همه‌ی indexها
- [ ] cleanup خودکار memory هنگام حذف Agent/Project
- [ ] audit حذف داده
- [ ] encryption-at-rest documentation
- [ ] سیاست backupهای حذف‌شده
- [ ] privacy policy
- [ ] terms of service
- [ ] DPA
- [ ] فهرست subprocessors

Memory Explorer هنوز contract جداگانه‌ی bearer token دارد و حذف Agent به‌صورت خودکار memoryهای مربوط را پاک نمی‌کند.

## P1 — Reliability و عملیات

### Observability

- [ ] metrics استاندارد API
- [ ] metrics queue و worker
- [ ] metrics provider و database
- [ ] metrics memory retrieval
- [ ] p50، p95 و p99 latency
- [ ] error، success، cancellation و retry rate
- [ ] provider failure rate
- [ ] queue depth و worker utilization
- [ ] cost per tenant
- [ ] alerting
- [ ] PagerDuty/Opsgenie integration
- [ ] SLO و SLA
- [ ] error budget
- [ ] operational dashboards
- [ ] distributed tracing برای مسیرهای حساس
- [ ] correlation بین web، BFF، server، worker و provider
- [ ] alert برای credential leakage
- [ ] alert برای unusual spend
- [ ] alert برای cross-tenant authorization failure
- [ ] log retention و rotation
- [ ] audit log خارج از process

OTel و Langfuse فعلاً optional هستند و evaluation و بخشی از مسیرهای legacy هنوز تکمیل نشده‌اند.

### Incident response

- [ ] severity levelهای incident
- [ ] on-call rotation
- [ ] incident runbook
- [ ] security incident runbook
- [ ] provider outage runbook
- [ ] database outage runbook
- [ ] credential compromise runbook
- [ ] public status page
- [ ] incident communication template
- [ ] postmortem template
- [ ] customer notification process
- [ ] breach notification policy
- [ ] emergency kill switch برای همه‌ی executionها
- [ ] kill switch برای tenant یا provider مشخص
- [ ] suspend خودکار credential مشکوک

### Release و deployment

- [ ] CI کامل و reproducible
- [ ] اجرای CI روی checkout disposable
- [ ] server build، web build و lint در CI
- [ ] unit، integration و PostgreSQL test در CI
- [ ] browser E2E در CI
- [ ] Docker build و worker isolation smoke
- [ ] provider canary
- [ ] migration test و rollback test
- [ ] artifact retention
- [ ] versioned release artifact
- [ ] changelog و semantic versioning
- [ ] staging environment
- [ ] production environment
- [ ] blue/green یا canary deployment
- [ ] zero-downtime migration
- [ ] health، readiness و liveness check
- [ ] dependency health check
- [ ] graceful shutdown verification
- [ ] deploy lock
- [ ] environment drift detection
- [ ] configuration validation در startup
- [ ] عدم استفاده از default secret در production

## P1 — Product maturity

### Workflow lifecycle

- [ ] draft، published و archived state
- [ ] versioning واقعی workflow
- [ ] immutable published version
- [ ] compare نسخه‌ها
- [ ] rollback به نسخه‌ی قبلی
- [ ] release notes برای workflow
- [ ] environmentهای dev، staging و production
- [ ] promotion بین environmentها
- [ ] approval برای publish
- [ ] branch یا workspace برای تغییرات
- [ ] validation هنگام publish
- [ ] migration workflowهای قدیمی
- [ ] جلوگیری از اجرای draft به‌صورت ناخواسته
- [ ] snapshot کامل workflow هنگام run
- [ ] snapshot agent و tool configuration هنگام run
- [ ] provenance برای خروجی run

در history فعلی، snapshot کامل configuration مربوط به execution به‌صورت مستقل ذخیره نمی‌شود.

### Run management

- [ ] run priority
- [ ] pause/resume کامل
- [ ] replay از checkpoint
- [ ] retry از node مشخص
- [ ] partial retry با تضمین idempotency
- [ ] deduplication سراسری
- [ ] run retention policy
- [ ] archive و export run
- [ ] share امن run
- [ ] run comparison
- [ ] run cost breakdown
- [ ] redaction ورودی/خروجی run
- [ ] cancellation guarantee
- [ ] stale run detection
- [ ] recovery پس از deployment
- [ ] recovery پس از worker crash
- [ ] manual recovery tooling
- [ ] administrative run termination

### Tool governance

- [ ] approval policy عمومی برای toolها
- [ ] policy در سطح agent، workflow و environment
- [ ] allowlist دامنه‌های HTTP
- [ ] denylist مقصدهای داخلی
- [ ] SSRF protection
- [ ] egress policy
- [ ] database read/write policy
- [ ] destructive operation approval
- [ ] tool versioning
- [ ] tool health check
- [ ] tool timeout، retry و circuit breaker
- [ ] tool usage audit
- [ ] tool ownership و sharing
- [ ] tool certification
- [ ] file tool امن
- [ ] CLI tool امن
- [ ] custom tool sandboxed

در وضعیت فعلی، file، cli و custom عمداً fail-closed هستند و metadata مربوط به impact/permission هنوز policy کامل runtime نیست.

### Agent management

- [ ] agent versioning
- [ ] agent publish/unpublish
- [ ] agent environment separation
- [ ] agent health monitoring
- [ ] agent concurrency و cost quota
- [ ] agent approval policy
- [ ] capability declaration
- [ ] model fallback
- [ ] model deprecation handling
- [ ] provider connection management
- [ ] provider connection test
- [ ] secret rotation UI
- [ ] agent rollback
- [ ] backend/configuration snapshot در history
- [ ] تمایز خطای read از resource-not-found
- [ ] retry UI برای خطای load

## P1 — API و ecosystem

### Public API

- [ ] API versioning
- [ ] OpenAPI specification
- [ ] API key authentication
- [ ] OAuth client support
- [ ] scoped API tokens
- [ ] token rotation
- [ ] webhook signing
- [ ] webhook retries
- [ ] webhook replay protection
- [ ] webhook delivery log
- [ ] webhook dead-letter queue
- [ ] SDK برای TypeScript
- [ ] SDK برای Python
- [ ] CLI رسمی stable
- [ ] pagination استاندارد
- [ ] filtering و sorting استاندارد
- [ ] idempotency key
- [ ] rate-limit headers
- [ ] request correlation ID
- [ ] API deprecation policy
- [ ] backward compatibility policy

### Integrations

- [ ] GitHub OAuth App یا GitHub App با permission حداقلی
- [ ] GitLab integration
- [ ] Bitbucket integration
- [ ] Slack notification
- [ ] email notification
- [ ] Teams notification
- [ ] Jira/Linear integration
- [ ] generic HTTP webhook
- [ ] S3-compatible artifact storage
- [ ] object storage برای خروجی‌ها
- [ ] secrets manager integration
- [ ] external database connection management
- [ ] custom MCP server management
- [ ] integration health status
- [ ] reconnect و credential refresh
- [ ] per-tenant integration isolation

## P1 — امنیت سازمانی و compliance

### Authentication maturity

- [ ] MFA/TOTP
- [ ] WebAuthn/passkeys
- [ ] SSO
- [ ] SAML
- [ ] OIDC
- [ ] SCIM provisioning
- [ ] مشاهده و revoke sessionهای فعال
- [ ] password reset امن
- [ ] email verification
- [ ] brute-force protection
- [ ] login rate limit
- [ ] suspicious login detection
- [ ] device/session audit
- [ ] account lockout policy
- [ ] backup codes

### Security assurance

- [ ] threat model رسمی
- [ ] data-flow diagram امنیتی
- [ ] abuse-case analysis
- [ ] SAST
- [ ] DAST
- [ ] dependency scanning
- [ ] secret scanning
- [ ] container scanning
- [ ] IaC scanning
- [ ] penetration test
- [ ] external security review
- [ ] vulnerability disclosure policy
- [ ] security.txt
- [ ] CVE response SLA
- [ ] patch management
- [ ] SBOM
- [ ] signed releases
- [ ] tamper-evident audit logs
- [ ] quarterly access review
- [ ] least-privilege review
- [ ] tenant isolation fuzzing
- [ ] SSRF test suite
- [ ] prompt injection test suite
- [ ] tool abuse test suite
- [ ] model output exfiltration tests

### Compliance و فروش enterprise

- [ ] SOC 2 readiness
- [ ] ISO 27001 readiness
- [ ] GDPR readiness
- [ ] DPA
- [ ] subprocessors page
- [ ] security questionnaire
- [ ] vendor risk management
- [ ] data processing inventory
- [ ] audit evidence retention
- [ ] business continuity plan
- [ ] disaster recovery evidence
- [ ] SLA document
- [ ] uptime commitment
- [ ] support tiers
- [ ] enterprise support contract

## P2 — مقیاس و بلوغ بلندمدت

### Scalability

- [ ] load test با provider واقعی یا mock کنترل‌شده
- [ ] stress test چند tenant هم‌زمان
- [ ] stress test memory retrieval و SSE
- [ ] stress test graphهای بزرگ
- [ ] database indexing review
- [ ] partitioning برای runs/events
- [ ] archival storage
- [ ] read replicas
- [ ] connection pool management
- [ ] cache strategy
- [ ] distributed cache
- [ ] rate limit توزیع‌شده
- [ ] horizontal scaling test
- [ ] regional deployment
- [ ] multi-region failover
- [ ] tenant-aware sharding
- [ ] noisy-neighbor protection
- [ ] capacity planning
- [ ] autoscaling policy

### Data و storage

- [ ] object storage برای log و artifact حجیم
- [ ] artifact lifecycle
- [ ] compression
- [ ] event archival
- [ ] pagination برای collectionهای بزرگ
- [ ] export/import asynchronous
- [ ] integrity check
- [ ] checksum برای artifact
- [ ] deduplication فایل و memory
- [ ] database maintenance policy
- [ ] index monitoring
- [ ] slow query monitoring
- [ ] storage quota
- [ ] tenant storage billing

### UX و محصول نهایی

- [ ] onboarding کامل
- [ ] نمونه workflowهای آماده
- [ ] guided provider setup
- [ ] provider connection wizard
- [ ] health dashboard قابل‌فهم
- [ ] تفاوت واضح draft و published
- [ ] خطاهای قابل‌اقدام
- [ ] retry از UI
- [ ] keyboard accessibility
- [ ] screen reader support
- [ ] WCAG audit
- [ ] responsive mobile experience
- [ ] localization واقعی
- [ ] RTL polish
- [ ] timezone handling
- [ ] notification center
- [ ] email/browser notifications
- [ ] activity feed
- [ ] global search
- [ ] command palette
- [ ] user preferences
- [ ] support/contact flow
- [ ] feedback collection
- [ ] in-product changelog
- [ ] documentation داخل محصول

### Support و عملیات مشتری

- [ ] ticketing integration
- [ ] support inbox
- [ ] customer identity verification
- [ ] tenant impersonation با audit و approval
- [ ] diagnostic bundle
- [ ] export log برای پشتیبانی
- [ ] support access expiration
- [ ] SLA tracking
- [ ] status page
- [ ] incident communication
- [ ] knowledge base
- [ ] migration و upgrade guide
- [ ] self-hosted support runbook
- [ ] license management برای self-hosted

## اولویت اجرایی پیشنهادی

برای production اولیه، این موارد را در اولویت قرار دهید:

1. Credential Broker خارجی
2. Provider canary واقعی
3. queue و worker lifecycle قابل‌بازیابی
4. backup/restore و disaster recovery
5. CI disposable و reproducible
6. Docker image scanning و SBOM
7. rate limit و quota per tenant
8. RBAC و organization management
9. API key و service account
10. billing یا حداقل usage/quota enforcement
11. audit log و incident response
12. workflow versioning و immutable published versions

بعد از آن، برای SaaS بالغ باید SSO/MFA/SCIM، webhook و public API، observability و SLO، data export/deletion/privacy، support/compliance و scale-out execution تکمیل شوند.

## مراجع پروژه

- [Roadmap](./roadmap.md)
- [Implementation gaps](./implementation-gaps.md)
- [Architecture](./architecture.md)
- [Development and deployment](./development.md)
- [Deferred credential gateway](./deferred-credential-gateway.md)
- [Phase 6 tools](./phase-6-tools.md)
- [Phase 8 memory explorer](./phase-8-memory-explorer.md)
- [Phase 7 approvals](./phase-7-approvals.md)
