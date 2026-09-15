# معماری Multi-Agent Studio

## جریان اصلی

```text
Browser / Next.js Control Plane
        │ Auth.js session
        ▼
Next server-side BFF (/api/execution)
        │ signed X-Multi-Agent-Principal
        ▼
Hono Execution Server
        │ authenticate → authorize → validate → compile
        ▼
LangGraph StateGraph
        │
        ├── AgentRuntime → API / local model / CLI executor
        ├── ToolRuntime  → function / configured HTTP executor
        ├── Memory       → short-term checkpoint + long-term service
        └── RunStore     → events, history, approvals, snapshots
```

## مرزهای اعتماد

- مرورگر فقط control plane است و هیچ workflow، agent، tool، credential یا principal ارسالی از browser را authoritative نمی‌کند.
- Auth.js در Next.js هویت کاربر را از session resolve می‌کند. BFF فقط headerهای مجاز را forward کرده و یک assertion کوتاه‌عمر HMAC با `userId` و `tenantId` می‌سازد.
- Execution Server assertion را verify می‌کند و ownership/tenant را در Store و APIها اعمال می‌کند. نبودن یا نامعتبر بودن assertion باید fail-closed باشد.
- Workflow validation و انتخاب agent/tool در سرور انجام می‌شود. داده‌ی client فقط پیشنهاد یا درخواست است.
- credentialهای provider در AgentRecord، WorkflowDefinition، ToolRecord، run input، event و `WorkerSpec.env` ذخیره نمی‌شوند.

## اجرای agent

`AgentRuntime` قبل از ساخت executor، agent فعال، backend، policy و tool assignment را بررسی می‌کند. `AgentExecutorFactory` برای backendهای API، local model و CLI executor مناسب را می‌سازد و eventهای provider-specific را به قرارداد مشترک `RunEvent` تبدیل می‌کند.

CLI از `WorkerRuntime` عبور می‌کند:

- `local`: process محدودشده برای کد trusted؛ sandbox امنیتی OS نیست.
- `container`: worker image مستقل با user غیر root، root filesystem فقط‌خواندنی، network خاموش به‌صورت پیش‌فرض، capabilityهای حذف‌شده و resource limits. برای کد untrusted باید image digest-pinned استفاده شود.

جزئیات ساخت image و credential delivery در [cli-worker-image.md](cli-worker-image.md) و [development.md](development.md) است.

### سیاست پرچم‌های امنیتی CLI

پرچم‌های امنیتی providerهای CLI از `workerMode` تصمیم‌گیری می‌شوند، نه ضمنی از نوع agent:

- `LocalProcessWorkerRuntime` مرز امنیتی OS نیست و برای کد trusted اجرا می‌شود؛ sandbox، approval و کنترل‌های امنیتی بومی provider باید دست‌نخورده بمانند. runtime فقط پیش‌فرض‌های headless خنثی تزریق می‌کند (مثل `--print` برای Claude یا `--skip-git-repo-check` برای Codex، چون workspace غیر Git برای agentهای همه‌منظوره معتبر است و نبود `.git` نشانه‌ی workspace ناقص نیست).
- `ContainerWorkerRuntime` مرز امنیتی صریح است: image digest-pinned، user غیر root، rootfs فقط‌خواندنی، `--cap-drop ALL`، `no-new-privileges`، شبکه‌ی پیش‌فرض `none` و home tmpfs موقت — همه‌ی این‌ها server-owned هستند و agent/workflow نمی‌توانند آن‌ها را تضعیف کنند. فقط در این حالت runtime مجاز است پرچم‌های sandbox/approval سطح provider را که با اجرای headless خودکار تضاد دارند تزریق کند، و workerهای یک‌بارمصرف باید از حالت ephemeral provider استفاده کنند تا session state ماندگار نشود.
- آرگومان‌های صریح agent authoritative هستند: پرچم‌های auto-managed فقط در نبودشان تزریق می‌شوند و هرگز دوبار نوشته یا بازنویسی نمی‌شوند.

مصداق کنونی — Codex در حالت بدون آرگومان صریح:

```text
local:     codex exec --skip-git-repo-check -
container: codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --ephemeral -
```

در local هیچ پرچم دورزدن sandbox یا approval تزریق نمی‌شود. Claude همین الگو را با `--dangerously-skip-permissions` فقط برای container دنبال می‌کند.

قواعد الزامی برای CLI integrationهای آینده:

1. Agentهای CLI محلی باید sandbox، approval و کنترل‌های امنیتی بومی provider را حفظ کنند، مگر استثنای صریح و مستندشده.
2. شل‌کردن sandbox/approval سطح provider فقط وقتی مجاز است که runtime کانتینر مرز امنیتی صریح باشد.
3. workerهای یک‌بارمصرف container نباید session state ماندگار نگه دارند وقتی provider حالت ephemeral دارد.
4. پرچم‌های امنیتی وابسته به runtime از worker/runtime mode تصمیم‌گیری می‌شوند، نه ضمنی از نوع agent.
5. آرگومان‌های کاربر authoritative می‌مانند؛ پیش‌فرض‌های auto-managed نباید آن‌ها را دوبار بنویسند یا بی‌دلیل بازنویسی کنند.

## Workflow و اجرا

`WorkflowDefinition` منبع حقیقت ساختار graph است؛ React Flow فقط editor/view است. سرور graph را validate و compile می‌کند. `RunExecutor` یک snapshot از workflow، agentها و toolها می‌سازد، lifecycle eventها را در `RunStore` ثبت می‌کند و SSE را از همان eventهای sanitized تغذیه می‌کند.

Whole-run و conditional branch-level cancellation وجود دارد؛ branch cancel از API و scheduler عبور می‌کند و فقط downstream همان branch را cooperative skip می‌کند. loopهای عمومی همچنان محدود به guardrail هستند؛ برای محدودیت‌های دیگر به [implementation-gaps.md](implementation-gaps.md) رجوع کنید.

## Persistence و memory

- PostgreSQL ایزوله منبع durable برای Studio entities، taskها، runها، eventها، approvalها و long-term memory است.
- migrationها صریح و خارج از startup اجرا می‌شوند.
- checkpoint و paused context برای recovery approval استفاده می‌شوند؛ workerهای فعال، SSE listenerها و timerها process-local هستند.
- short-term memory داخل state/checkpoint همان run است؛ long-term memory از `MemoryService` و namespace/tenant authorization عبور می‌کند.
- Redis در معماری فعلی استفاده نمی‌شود.

جزئیات در [phase-6-memory.md](phase-6-memory.md)، [phase-8-memory-explorer.md](phase-8-memory-explorer.md) و [phase-9-persistence.md](phase-9-persistence.md) آمده است.

## Tools و approval

Tool entity در registry مستقل است و workflow node یا agent فقط به `toolId` ارجاع می‌دهد. function و configured HTTP قابل اجرا هستند؛ database، search و MCP نیز فقط با aliasهای server-owned و credential gateway کوتاه‌عمر اجرا می‌شوند. file، CLI و custom همچنان fail-closed هستند.

Human approval با LangGraph `interrupt`/resume انجام می‌شود و branchهای آن فقط `approved` و `rejected` هستند. در حالت PostgreSQL، رکورد approval و paused context durable است؛ execution فعال و timer پس از restart نیازمند recovery است.

## Observability

Operational truth در `RunStore`/`StudioStore` و execution timeline است. OpenTelemetry و Langfuse فقط لایه‌ی deep observability اختیاری هستند و خرابی exporter نباید workflow را fail کند. usage و cost فقط وقتی نمایش داده می‌شوند که provider مقدار معتبر گزارش کرده باشد؛ cost تخمینی ساخته نمی‌شود.

## ساختار کد

```text
apps/web/                 Next.js control plane، Auth.js، BFF و UI
apps/server/              Hono API، composition، compiler، RunExecutor و stores
packages/types/            قراردادهای مشترک domain و event
src/agents/runtime/        AgentRuntime، executors و WorkerRuntime
src/tools/                ToolRuntime و executorهای ابزار
src/memory/                قراردادها، application و PostgreSQL/in-memory adapters
src/observability/         telemetry و redaction
infrastructure/            PostgreSQL migrations و Docker worker image
docs/                     مستندات canonical جاری
```
