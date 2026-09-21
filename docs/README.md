# مستندات Multi-Agent Studio

این پوشه فقط مستندات جاری و قابل اتکا را نگه می‌دارد. وضعیت فعلی و محدودیت‌های شناخته‌شده باید با کد و تست‌ها هم‌خوان باشند؛ گزارش‌ها و promptهای قدیمی منبع تصمیم‌گیری نیستند.

## مسیر مطالعه

1. [Roadmap و وضعیت فازها](roadmap.md)
2. [معماری سیستم و مرزهای اعتماد](architecture.md)
3. [توسعه و اجرای محلی](development.md)
4. [محدودیت‌های باقی‌مانده](implementation-gaps.md)
5. [آخرین شواهد verification](verification.md)

## مستندات عملیاتی و قابلیت‌ها

- [صفحه‌ی Agent و تنظیمات](agent-detail-page.md)
- [Tool registry و اجرای ابزار](phase-6-tools.md)
- [Memory backend و policy](phase-6-memory.md)
- [Memory Explorer](phase-8-memory-explorer.md)
- [Human approval](phase-7-approvals.md)
- [Persistence، history و recovery](phase-9-persistence.md)
- [ساخت و اجرای CLI worker image](cli-worker-image.md)
- [معماری deferred برای Credential Gateway](deferred-credential-gateway.md)

## قرارداد مستندات

- `architecture.md` مرجع ساختار runtime و trust boundary است.
- `development.md` مرجع setup، environment و verification محلی است.
- `roadmap.md` فقط خلاصه‌ی وضعیت فازهاست، نه specification اجرایی.
- `implementation-gaps.md` تنها فهرست gapهای باز و محدودیت‌های عمدی است.
- جزئیات قدیمی در git history باقی می‌ماند و در runtime یا توسعه‌ی جدید استفاده نمی‌شود.
