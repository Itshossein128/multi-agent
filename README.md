# Multi-Agent Studio

> یک پلتفرم self-hosted برای تعریف، اجرای و مشاهده‌ی workflowهای چندایجنتی است.

وب‌اپلیکیشن نقش control plane را دارد؛ سرور TypeScript اجرای workflow، policy، مالکیت، ابزارها و persistence را کنترل می‌کند و LangGraph موتور اجرای graph است.

## شروع سریع

پیش‌نیازها: Node.js 20+، pnpm 10.17.0 و Docker برای PostgreSQL.

```bash
pnpm install --frozen-lockfile
pnpm db:dev:up
pnpm db:migrate
pnpm dev
```

برای verification کامل:

```bash
pnpm test --runInBand
pnpm --filter server build
pnpm --filter web build
```

## مستندات

فهرست canonical مستندات در [`docs/README.md`](docs/README.md) قرار دارد. از فایل‌های prompt، plan و report تاریخی به‌عنوان منبع معماری استفاده نکنید؛ وضعیت جاری در [`docs/roadmap.md`](docs/roadmap.md)، محدودیت‌ها در [`docs/implementation-gaps.md`](docs/implementation-gaps.md) و شواهد آخرین verification در [`docs/verification.md`](docs/verification.md) ثبت می‌شود.

برای مطالعه‌ی آموزشی و استفاده‌ی مرحله‌به‌مرحله از نرم‌افزار، سایت مستندات را اجرا کنید:

```bash
pnpm --filter docs dev
```

سپس به `http://localhost:3070` بروید. کد سایت در [`apps/docs`](apps/docs) قرار دارد و محتوای canonical این repository همچنان در `docs/` نگه‌داری می‌شود.
