# مستندات Multi-Agent Studio

این پوشه فقط مستندات جاری و قابل اتکا را نگه می‌دارد. وضعیت فعلی و محدودیت‌های شناخته‌شده باید با کد و تست‌ها هم‌خوان باشند؛ گزارش‌ها و promptهای قدیمی منبع تصمیم‌گیری نیستند.

## مسیر مطالعه

1. [Roadmap و وضعیت فازها](roadmap.md)
2. [معماری سیستم و مرزهای اعتماد](architecture.md)
3. [توسعه و اجرای محلی](development.md)
4. [محدودیت‌های باقی‌مانده](implementation-gaps.md)
5. [آخرین شواهد verification](verification.md)

## مسیر آموزشی سایت

برای کاربری که پروژه را تازه می‌شناسد، سایت مستندات در `apps/docs` مسیر زیر را ارائه می‌کند:

1. نصب و راه‌اندازی
2. راه‌های اجرا (Studio، CLI، broker، worker، build تولیدی)
3. اولین workflow از Agent تا Run
4. مفاهیم Organization، Project، Workspace، Agent، Workflow، Task و Run
5. ساخت Agent و طراحی Workflow
6. مدیریت Task (پیوند به یک workspace و یک یا چند project) و مشاهده‌ی Run
7. Tools، Approvals و Memory
8. Persistence، Worker و Credential Broker
9. فهرست/داشبورد Project و Workspace در Studio (جدا از package import/export در `/studio/workspace`)
10. Deployment، Troubleshooting و Limitations

این سایت نقش tutorial و navigation را دارد؛ فایل‌های این پوشه همچنان منبع جزئیات معماری، verification و محدودیت‌های فنی هستند.

## مستندات عملیاتی و قابلیت‌ها

- [صفحه‌ی Agent و تنظیمات](agent-detail-page.md)
- [Tool registry و اجرای ابزار](phase-6-tools.md)
- [Memory backend و policy](phase-6-memory.md)
- [Memory Explorer](phase-8-memory-explorer.md)
- [Production Memory Benchmark](memory-benchmark.md)
- [Human approval](phase-7-approvals.md)
- [Persistence، history و recovery](phase-9-persistence.md)
- [ساخت و اجرای CLI worker image](cli-worker-image.md)
- [معماری deferred برای Credential Gateway](deferred-credential-gateway.md)
- [هدف‌های سازمانی، تفویض و سقف هزینه](organization-and-cost-budgets.md)

## قرارداد مستندات

- `architecture.md` مرجع ساختار runtime و trust boundary است.
- `development.md` مرجع setup، environment و verification محلی است.
- `roadmap.md` فقط خلاصه‌ی وضعیت فازهاست، نه specification اجرایی.
- `implementation-gaps.md` تنها فهرست gapهای باز و محدودیت‌های عمدی است.
- جزئیات قدیمی در git history باقی می‌ماند و در runtime یا توسعه‌ی جدید استفاده نمی‌شود.
