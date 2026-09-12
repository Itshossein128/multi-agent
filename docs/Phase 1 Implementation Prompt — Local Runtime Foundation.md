# Phase 1 Implementation Prompt — Local Runtime Foundation

تو یک Senior Platform Engineer، Backend Engineer و Security-minded Software Architect هستی. وظیفه‌ات پیاده‌سازی کامل فاز ۱ در repository فعلی است، نه فقط ارائه‌ی پیشنهاد یا طراحی تئوری.

## هدف فاز ۱

یک foundation قابل‌اعتماد برای اجرای multi-agent ایجاد کن که:

1. `apps/web` و `apps/server` همچنان به‌صورت local اجرا شوند.
2. PostgreSQL و dependencyهای پایدار از طریق Docker Compose اجرا شوند.
3. اجرای agentهای process-based پشت یک abstraction مشخص به نام `WorkerRuntime` قرار بگیرد.
4. در این فاز worker به‌صورت local process اجرا شود، اما API آن برای Docker، VM، gVisor یا Firecracker در آینده قابل توسعه باشد.
5. cancellation، timeout، workspace boundary، output limit و logging به‌صورت کنترل‌شده پیاده‌سازی شوند.
6. رفتار فعلی workflow، persistence، approval و agent runtime خراب نشود.

---

## اطلاعات فعلی پروژه

ابتدا این فایل‌ها و مسیرها را بررسی کن:

- `AGENTS.md`
- `README.md`
- `docs/development.md`
- `docs/implementation-gaps.md`
- `docs/phase-9-persistence.md`
- `docs/phase-6-tools.md`
- `apps/server/src/index.ts`
- `apps/server/src/runtime/runExecutor.ts`
- `src/agents/runtime/agentRuntime.ts`
- `src/agents/runtime/types.ts`
- `src/agents/runtime/cliAgentExecutor.ts`
- `src/agents/runtime/agentExecutorFactory.ts`
- `src/agents/runtime/executionPolicy.ts`
- `apps/server/src/studio/composition.ts`
- `apps/server/src/memory/composition.ts`
- `infrastructure/memory/compose.yml`
- `infrastructure/docker/docker-compose.yml`
- `.env.example`
- `package.json`

این repository یک pnpm monorepo است:

- Backend: `apps/server`
- Frontend: `apps/web`
- Server فعلی با Hono اجرا می‌شود و port پیش‌فرض آن `4000` است.
- PostgreSQL با `MEMORY_DATABASE_URL` یا `STUDIO_DATABASE_URL` تنظیم می‌شود.
- Migrationها عمداً هنگام startup اجرا نمی‌شوند و باید explicit اجرا شوند.
- `CliAgentExecutor` در حال حاضر با `spawn(..., { shell: false })` اجرا می‌شود.
- CLI agentها با allowlist اجرایی و workspace کنترل می‌شوند.
- ابزارهای `mcp`، `database`، `search`، `file` و ابزارهای دارای side effect هنوز runtime واقعی ندارند.
- اجرای فعلی agentها OS-level sandbox نیست.
- `infrastructure/docker/docker-compose.yml` قدیمی است و نباید بدون بررسی به‌عنوان compose اصلی مدرن فرض شود.

اگر `graphify-out/graph.json` وجود دارد، قبل از exploration گسترده از graphify query برای درک dependencyها استفاده کن. graph را بدون نیاز rebuild نکن.

---

## قواعد کاری

قبل از هر تغییر:

1. `git status` را بررسی کن.
2. تغییرات موجود کاربر را حفظ کن.
3. از `git reset --hard`، `git clean`، حذف گسترده فایل‌ها یا overwrite کردن تغییرات نامرتبط استفاده نکن.
4. ابتدا تست‌های فعلی یا تست‌های مرتبط را اجرا کن تا baseline مشخص شود.
5. قبل از اضافه‌کردن abstraction جدید، بررسی کن abstraction مشابهی در repository وجود نداشته باشد.
6. هیچ credential واقعی، API key یا secret را commit نکن.
7. هیچ درخواست شبکه‌ای واقعی، push، clone، migration روی دیتابیس production یا تغییر external service انجام نده.

---

# محدوده‌ی پیاده‌سازی

## بخش ۱: استانداردسازی محیط توسعه

از `infrastructure/memory/compose.yml` به‌عنوان نقطه‌ی شروع استفاده کن.

این موارد را انجام بده:

- یک مسیر canonical و مستند برای اجرای PostgreSQL محلی تعیین کن.
- اگر compose فعلی نیازمند اصلاح است، آن را اصلاح کن؛ compose رقیب و موازی ایجاد نکن مگر دلیل فنی واضح داشته باشی.
- PostgreSQL باید:
  - روی loopback bind شود.
  - healthcheck داشته باشد.
  - named volume داشته باشد.
  - credential پیش‌فرض آن فقط برای development باشد.
  - به Langfuse database وابسته یا متصل نباشد.
- تنظیمات زیر را در `.env.example` کامل و واضح کن:

```env
MEMORY_DATABASE_URL=postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory
STUDIO_DATABASE_URL=
MEMORY_STORE=postgres
STUDIO_STORE=postgres
STUDIO_MEMORY_POSTGRES_PORT=55432
STUDIO_MEMORY_POSTGRES_PASSWORD=studio_memory_local
```

- اگر لازم است scriptهای root را اضافه یا اصلاح کن، مانند:

```json
{
  "dev": "...",
  "dev:server": "...",
  "dev:web": "...",
  "db:dev:up": "...",
  "db:dev:down": "...",
  "db:migrate": "..."
}
```

نام scriptها را با convention فعلی پروژه هماهنگ کن.

- Migrationها را به startup server اضافه نکن.
- مستند کن که ترتیب اجرای local development چگونه است:

```bash
pnpm install --frozen-lockfile
docker compose -f infrastructure/memory/compose.yml --profile memory up -d
node infrastructure/memory/migrate.cjs
node infrastructure/studio/migrate.cjs
pnpm dev
```

دستورهای نهایی را پس از بررسی دقیق repository اصلاح کن.

Compose قدیمی در `infrastructure/docker/docker-compose.yml` را حذف نکن. اگر stale است، آن را مستند کن و فقط در صورت نیاز تغییر حداقلی بده.

---

## بخش ۲: طراحی WorkerRuntime

یک abstraction typed برای worker اضافه کن. قبل از ایجاد فایل جدید، ساختار فعلی `AgentExecutor` را بررسی کن و از duplicate abstraction جلوگیری کن.

API پیشنهادی باید مفهومی مشابه این داشته باشد:

```ts
export interface WorkerSpec {
  runId: string;
  nodeId: string;
  agentId: string;
  executable: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface WorkerHandle {
  workerId: string;
  runId: string;
  pid?: number;
}

export interface WorkerRuntime {
  start(spec: WorkerSpec): Promise<WorkerHandle>;
  stream(workerId: string): AsyncIterable<WorkerEvent>;
  wait(workerId: string): Promise<WorkerResult>;
  cancel(workerId: string, reason?: string): Promise<void>;
  cleanup(workerId: string): Promise<void>;
}
```

نام‌ها را در صورت نیاز با convention فعلی تطبیق بده، اما این قابلیت‌ها باید وجود داشته باشند:

- start
- stream output
- wait for completion
- cancellation
- timeout
- cleanup
- خروجی محدودشده
- شناسه‌ی یکتا برای هر worker
- correlation با `runId`، `nodeId` و `agentId`

پیاده‌سازی فاز ۱ باید `LocalProcessWorker` یا معادل آن باشد.

ویژگی‌های الزامی local worker:

- استفاده از `spawn` با `shell: false`
- عدم اجرای command از طریق shell string
- executable فقط از allowlist server پذیرفته شود.
- `cwd` باید absolute و تحت workspaceهای مجاز باشد.
- canonical path و symlink escape بررسی شود.
- `cwd` نباید به‌صورت پیش‌فرض repository root یا `/` باشد.
- env ورودی agent نباید بتواند allowlist، credential یا policy server را override کند.
- API key و secret در log یا event ذخیره نشود.
- stdout و stderr دارای سقف byte باشند.
- timeout باعث termination قطعی process شود.
- ابتدا termination graceful انجام شود و پس از grace period، در صورت نیاز process kill شود.
- cancellation از `AbortSignal` فعلی run دریافت شود.
- cleanup فقط resourceهایی را حذف کند که خود worker ایجاد کرده است.
- worker نباید خودش Docker، VM یا sandbox جدید اجرا کند.

برای processهایی که به‌صورت عادی توسط `CliAgentExecutor` اجرا می‌شوند، تا حد امکان منطق موجود را reuse کن و آن را duplicate نکن.

---

## بخش ۳: اتصال WorkerRuntime به Agent Runtime

`AgentRuntime` و `AgentExecutorFactory` را طوری اصلاح کن که WorkerRuntime به‌صورت dependency قابل تزریق باشد.

الزامات:

- public API فعلی تا حد امکان حفظ شود.
- تست‌های فعلی مربوط به `AgentExecutor` همچنان pass شوند.
- backendهای API و local model بدون دلیل وارد local process worker نشوند.
- backendهای CLI از مسیر worker abstraction استفاده کنند یا adapter تمیز و قابل تست داشته باشند.
- `RunExecutor` همچنان مسئول orchestration workflow باقی بماند.
- worker lifecycle نباید مستقیماً در compiler workflow پیاده‌سازی شود.
- cancellation از `runStore.signal(runId)` تا process child propagate شود.
- timeoutهای زیر باید هماهنگ باشند:
  - `RUN_MAX_DURATION_MS`
  - `AGENT_MAX_DURATION_MS`
  - `TOOL_MAX_DURATION_MS`
- processهای orphan شده بعد از پایان run باقی نمانند.
- اگر server restart شود، worker در حال اجرا قابل resume فرض نشود و رفتار آن با مستندات Phase 9 سازگار باشد.
- خطای worker باید به event و status مناسب run تبدیل شود.
- برای workerهای unsupported، رفتار صریح و قابل‌ردیابی داشته باش؛ موفقیت جعلی ایجاد نکن.

---

## بخش ۴: Workspace Boundary

یک policy یا allocator امن برای workspace اضافه کن، فقط در حدی که با رفتار فعلی سازگار باشد.

الزامات:

- workspace root باید از configuration server بیاید.
- path باید absolute باشد.
- path traversal و symlink escape مسدود شود.
- workspace خارج از allowlist رد شود.
- اگر workspace موقتی ایجاد می‌کنی، نام آن باید شامل شناسه‌ی run/worker امن و غیرقابل‌حدس باشد.
- cleanup فقط workspaceهای ساخته‌شده توسط همان worker را حذف کند.
- workspace موجود کاربر بدون اجازه‌ی صریح حذف یا reset نشود.
- اگر تغییر default رفتار فعلی باعث شکستن workflowهای موجود می‌شود، آن را feature-flag کن و دلیل را مستند کن.

فاز ۱ نیازمند Git worktree، clone خودکار، mount کردن repository یا snapshot کامل نیست؛ این موارد را به فاز بعدی موکول کن مگر اینکه برای سازگاری فعلی ضروری باشند.

---

## بخش ۵: Logging و Observability

برای lifecycle worker، structured logging اضافه کن یا logging فعلی را توسعه بده.

حداقل contextهای زیر باید در logهای lifecycle وجود داشته باشند:

```text
runId
workflowId
taskId
agentId
nodeId
workerId
backend
event
durationMs
exitCode
terminationReason
```

این موارد نباید در log ذخیره شوند:

- API key
- bearer token
- credential
- کل prompt
- کل stdout/stderr بدون محدودیت
- secretهای موجود در environment

eventهای جدید را با مدل event فعلی سازگار کن. اگر event عمومی اضافه می‌کنی، typeهای مشترک و consumerهای frontend را نیز بررسی و اصلاح کن.

---

# موارد خارج از محدوده‌ی فاز ۱

این موارد را در این فاز پیاده‌سازی نکن:

- Docker worker runtime
- اجرای agent داخل VM
- gVisor
- Firecracker یا microVM
- MCP gateway
- MCP server registry
- اتصال واقعی MCP به agent
- اجرای arbitrary HTTP/database/file/search tools
- ابزارهای دارای side effect بدون approval
- اجرای کد کاملاً untrusted روی host
- تغییر معماری LangGraph
- بازطراحی UI سازمان یا workflow
- تغییر مدل‌های فعلی agent بدون migration مشخص
- جایگزینی کامل Docker production architecture
- افزودن authentication جدید
- اتصال به سرویس خارجی واقعی
- commit کردن secret یا mock credential به‌عنوان credential واقعی

در انتهای مستندات، صریحاً بنویس که MCP و worker containerization در فازهای بعدی هستند.

---

# تست‌های الزامی

تست‌های unit و integration مناسب اضافه کن.

حداقل این سناریوها باید پوشش داده شوند:

## Worker lifecycle

- start موفق process
- دریافت stdout/stderr
- exit موفق
- exit با خطا
- timeout
- cancellation
- cleanup
- عدم باقی‌ماندن child process

## Security boundary

- executable خارج از allowlist رد شود.
- workspace نسبی رد شود.
- workspace خارج از root رد شود.
- path traversal رد شود.
- symlink escape رد شود.
- shell injection ممکن نباشد.
- env مخرب نتواند policy server را override کند.
- output بزرگ truncate یا reject شود.
- secret در log دیده نشود.

## Runtime integration

- `AgentRuntime` با worker injected قابل تست باشد.
- `RunExecutor.cancel()` به worker cancellation برسد.
- agent failure به run failure تبدیل شود.
- timeout agent به وضعیت صحیح run تبدیل شود.
- worker ID در lifecycle event یا log قابل ردیابی باشد.
- backendهای فعلی regression نداشته باشند.

## Persistence و توسعه‌ی محلی

- Compose configuration معتبر باشد.
- PostgreSQL healthcheck کار کند.
- migrationها طبق مسیر مستند اجرا شوند.
- server با PostgreSQL روشن startup شود.
- server بدون PostgreSQL نیز طبق رفتار فعلی و configuration مجاز، خطای واضح بدهد و silent fallback خطرناک نداشته باشد.
- endpoint `GET /health` همچنان کار کند.

تست‌های live PostgreSQL را فقط با database/schema تست ایزوله اجرا کن. به دیتابیس production یا دیتابیس Langfuse متصل نشو.

---

# دستورهای verification

در پایان، این موارد را اجرا کن و نتیجه‌ی واقعی را گزارش بده:

```bash
pnpm test -- --runInBand
pnpm --filter server build
pnpm --filter web build
docker compose -f infrastructure/memory/compose.yml config
```

اگر Docker در محیط موجود بود:

```bash
docker compose -f infrastructure/memory/compose.yml --profile memory up -d
node infrastructure/memory/migrate.cjs
node infrastructure/studio/migrate.cjs
```

سپس server را اجرا کن و endpoint زیر را بررسی کن:

```text
GET http://localhost:4000/health
```

برای worker integration فقط از یک command بی‌خطر و مصنوعی استفاده کن؛ مثلاً یک process تستی که متن ثابت چاپ می‌کند. هیچ agent واقعی را با credential واقعی اجرا نکن.

اگر هر verification به دلیل نبودن Docker، credential، database یا dependency ممکن نبود، آن را به‌عنوان `BLOCKED` گزارش کن؛ تست جعلی یا نتیجه‌ی ساختگی ارائه نده.

---

# کیفیت کد

- TypeScript strict و type-safe بنویس.
- از abstractionهای قابل تزریق استفاده کن.
- process، timer و stream را حتماً cleanup کن.
- خطاها را با context کافی wrap کن اما secret را لو نده.
- از تغییرات بزرگ و unrelated خودداری کن.
- migration موجود را edit نکن؛ برای تغییر schema migration جدید ایجاد کن.
- README و docs را با رفتار واقعی هماهنگ کن.
- اگر طراحی پیشنهادی با معماری فعلی ناسازگار است، ابتدا کم‌ریسک‌ترین adapter را پیاده‌سازی کن.
- اگر بخشی ذاتاً متعلق به فاز ۲ است، آن را به‌عنوان extension point مستند کن، نه اینکه ناقص و ظاهراً کامل پیاده‌سازی کنی.

---

# خروجی نهایی مورد انتظار

در پایان پاسخ خودت را با این ساختار ارائه کن:

1. خلاصه‌ی تغییرات
2. فایل‌های تغییرکرده
3. معماری نهایی WorkerRuntime
4. روش اجرای PostgreSQL و server در development
5. تست‌های اجراشده و نتیجه‌ی واقعی آن‌ها
6. محدودیت‌های باقی‌مانده
7. مواردی که عمداً به Phase 2 موکول شدند
8. ریسک‌های امنیتی باقی‌مانده
9. دستورهای دقیق برای اجرای دستی
10. پیشنهاد مشخص برای Phase 2

فقط زمانی کار را complete اعلام کن که build، تست‌های مرتبط و verificationهای قابل‌اجرا واقعاً انجام شده باشند.