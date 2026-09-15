# Credential Gateway — معماری و وضعیت اجرا

**وضعیت: foundation پیاده‌سازی شده؛ gateway خارجی production هنوز deployment prerequisite است.**

## وضعیت فعلی

ابزارهای database، search و MCP از `EnvironmentCredentialGateway` استفاده می‌کنند: lease یک‌بارمصرف، کوتاه‌عمر و وابسته به tenant/principal/run است. mappingها فقط از env سرور خوانده می‌شوند و credential وارد ToolRecord، browser، event یا log نمی‌شود. gateway و credential delivery پیش‌فرض خاموش هستند. image worker هیچ credential یا login stateای ندارد و host directoryهای `.codex` و `.claude` mount نمی‌شوند.

دو مسیر توسعه‌ای موجود است:

- file delivery برای فایل credential مشخص و allowlisted؛
- environment delivery برای credential variable مشخص provider.

هر دو مسیر CLI برای development/trusted deployment هستند. gateway فعلی process-local است و برای multi-tenant با سطح تهدید بالا باید با broker خارجی دارای mTLS، rotation، revoke، audit و rate-limit جایگزین شود.

## ریسک باقی‌مانده

اگر worker یا dependency آن compromise شود، credentialی که برای همان run تحویل شده ممکن است قابل استفاده باشد. Docker نیز به‌تنهایی معادل VM یا sandbox قوی نیست و به daemon و policy میزبان وابسته است.

## هدف production

یک gateway جداگانه باید:

1. هویت run و مجوز provider را در سمت server بررسی کند؛
2. به‌جای long-lived secret، token کوتاه‌عمر و محدود به provider/run صادر کند؛
3. secret را خارج از image، workflow، AgentRecord، ToolRecord، event و log نگه دارد؛
4. revoke، rotation، audit و rate limit داشته باشد؛
5. هیچ credentialی را در browser یا header قابل تزریق کاربر قرار ندهد.

## شرط production

برای production gateway را با interface موجود جایگزین کنید، secretهای `TOOL_*` را از env فرایند حذف و به broker منتقل کنید، و سپس live rotation/revoke/audit و failure-injection را در محیط deployment اجرا کنید. تا آن زمان `TOOL_CREDENTIAL_GATEWAY_ENABLED=false` و worker container digest-pinned باقی بماند.
