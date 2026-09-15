# محدودیت‌ها و کارهای باقی‌مانده

آخرین بازبینی: 2026-09-14. این فایل تنها مرجع gapهای باز است؛ قابلیت‌های پیاده‌سازی‌شده در مستندات capability مربوطه و شواهد اجرای تست در [verification.md](verification.md) ثبت می‌شوند.

## محدودیت‌های عمدی

- **Branch-level cancellation:** برای branchهای conditional پیاده‌سازی شده و API مستقل دارد؛ fan-out ناشناس یا branch identity خارج از conditional graph هنوز پشتیبانی نمی‌شود.
- **Tool categories:** `database`، `search` و `mcp` با endpoint server-owned و credential lease اجرا می‌شوند؛ `file`، `cli` و `custom` عمداً fail-closed هستند.
- **Repository verification:** `repo-tests` و `repo-checks` به‌صورت پیش‌فرض خاموش‌اند و باید از WorkerRuntime عبور کنند. `repo-checks` فقط checkهای ثابت را اجرا می‌کند؛ `build` اکنون `run build` را با package manager server-selected و workspace read-write اجرا می‌کند، بنابراین workspace باید disposable باشد. local فقط برای workspace trusted است؛ برای repository غیرقابل‌اعتماد container digest-pinned لازم است.
- **CLI local:** `CLI_WORKER_MODE=local` محدودسازی process است، نه sandbox امنیتی OS. برای کد untrusted از container استفاده کنید.
- **Provider cost:** اگر provider هزینه‌ی معتبر گزارش نکند، مقدار `null`/ناموجود باقی می‌ماند و از token count هزینه‌ی مصنوعی محاسبه نمی‌شود.
- **Credential Gateway:** leaseهای process-local و adapter HTTP broker پیاده شده‌اند؛ production multi-tenant هنوز به broker خارجی واقعی، mTLS، rotation، revoke، audit و rate-limit نیاز دارد. [deferred architecture](deferred-credential-gateway.md) را ببینید.

## کارهای بعدی

1. اجرای broker خارجی و E2E providerهای واقعی در محیط deployment.
2. تکمیل Playwright برای failure، cancellation، task flow و browser دوم.
3. اتصال CI به checkout disposable برای package-manager build و ثبت artifact خروجی.
4. جایگزینی یا حذف مسیرهای legacy Langfuse و تکمیل evaluation/dataset.
5. بازبینی entity-lifecycle cleanup برای memory و حل conflictهای چندتب/چنددستگاه در registry.

## اصولی که نباید شکسته شوند

- browser منبع authority برای execution، ownership، credential یا permission نیست.
- workflow، agent و tool registry در زمان اجرا از server-owned data خوانده می‌شوند.
- event و telemetry قبل از persistence و delivery باید redacted و bounded باشند.
- retry فقط برای عملیات مجاز و idempotent است؛ side effect نباید بدون اثبات safety تکرار شود.
- هر قابلیت جدید ابزار یا credential باید همراه با policy، authorization، approval و تست رفتاری اضافه شود.
