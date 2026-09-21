# شواهد آخرین verification

آخرین اجرای ثبت‌شده در این workspace در 2026-09-14 انجام شده است. این فایل نتیجه‌ی commandها را ثبت می‌کند؛ در صورت تغییر کد باید دوباره اجرا و تاریخ آن به‌روزرسانی شود.

## نتیجه

| بررسی | نتیجه |
| --- | --- |
| Jest کامل | موفق — 36 suite و 320 تست |
| Server build | موفق — `pnpm --filter server build` |
| Web build | موفق — `pnpm --filter web build` |
| Diff hygiene | موفق — `git diff --check` |
| Tool/Worker focused tests | موفق — policy، timeout، output bound، symlink، `repo-tests`/package-manager build، gateway و database/search/MCP پوشش داده شده‌اند |
| Verification/load smoke | موفق — 5 check داخلی برای graph، loop budget، SSE، retention و concurrent run load |
| Real package build | موفق — `repo-checks(build)` از WorkerRuntime با `pnpm run build` |
| Real PostgreSQL tool query | موفق — `SELECT 1 AS live` روی PostgreSQL compose |
| Real Search/MCP HTTP | موفق — loopback HTTP harness با fetch واقعی و MCP session |
| Docker deployment smoke | موفق — pinned worker image build و isolation/cleanup checks |
| Deployment app image | موفق — workspace-aware Docker build با `pnpm@10.17.0` و CLI image smoke |

## نکات verification

- `repo-tests` به‌صورت پیش‌فرض disabled است؛ تست آن باید از WorkerRuntime عبور کند و `spec.env` را مستقیماً از process environment forward نکند.
- `repo-checks` نیز به‌صورت پیش‌فرض disabled است؛ فقط `test,typecheck,build,lint,diff` را می‌پذیرد و command دلخواه را رد می‌کند. سناریوی موفق/ناموفق هر check و read-only/no-network worker در `tests/toolExecution.test.ts` پوشش داده شده است.
- local CLI worker محدودشده است اما sandbox OS نیست. ادعای isolation برای کد untrusted فقط با container profile و image digest-pinned معتبر است.
- persistence در PostgreSQL با sticky failure و flush هنگام shutdown fail-closed رفتار می‌کند؛ در نبود database، in-memory فقط برای development/test composition است.
- Auth.js، BFF و internal principal assertion باید همراه با secretهای محیطی معتبر در محیط اجرا بررسی شوند؛ secretهای local در این گزارش ثبت نمی‌شوند.

## اجرای مجدد

```bash
pnpm test -- --runInBand
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

E2E providerهای بیرونی و gateway خارجی همچنان به endpoint، credential broker و policy واقعی deployment نیاز دارند؛ این موارد در این workspace شبیه‌سازی یا ادعا نشده‌اند.
