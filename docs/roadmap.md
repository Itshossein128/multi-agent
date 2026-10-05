# Roadmap و وضعیت فعلی

این فایل خلاصه‌ی وضعیت محصول است. جزئیات اجرایی را در مستند capability مربوطه و محدودیت‌ها را در [implementation gaps](implementation-gaps.md) بخوانید.

## معماری هدف

```text
Next.js Control Plane
        │ Auth.js session + server-side BFF
        ▼
TypeScript Execution Server
        │ validate → authorize → compile → execute
        ▼
LangGraph + AgentRuntime + ToolRuntime + Memory
        │
        ├── PostgreSQL: Studio, runs, approvals, memory
        ├── WorkerRuntime: local trusted / container preferred
        └── Optional OpenTelemetry/Langfuse
```

## وضعیت فازها

| حوزه | وضعیت جاری | مرجع |
| --- | --- | --- |
| Dashboard، Task Board و Graph Editor | موجود و متصل به مدل‌های اصلی؛ جزئیات کنترل عملیاتی در حال تکامل است | [architecture](architecture.md) |
| اجرای workflow و timeline | موجود؛ validation سروری، event stream، approval و whole-run retry دارد | [approvals](phase-7-approvals.md)، [gaps](implementation-gaps.md) |
| Agent management | موجود؛ registry، policy، diagnostics و standalone test دارد | [agent detail](agent-detail-page.md) |
| Tool registry | function، HTTP، database، search و MCP با gateway server-owned قابل اجرا هستند؛ file/CLI/custom fail-closed هستند | [tools](phase-6-tools.md) |
| Memory | backend long-term، retrieval، authorization و Explorer موجود است | [memory](phase-6-memory.md)، [Explorer](phase-8-memory-explorer.md) |
| Persistence و recovery | PostgreSQL برای Studio/run/history؛ stateهای transient هنوز process-local هستند | [persistence](phase-9-persistence.md) |
| Observability | OTel/Langfuse اختیاری و server-side؛ evaluation و بعضی legacy مسیرها خارج از scope هستند | [gaps](implementation-gaps.md) |
| Security hardening | validation، redaction، bounds، ownership و worker container foundation موجود است | [gaps](implementation-gaps.md)، [worker image](cli-worker-image.md) |

## کارهای بعدی با اولویت

1. استقرار credential broker خارجی (کد در `src/broker/` موجود) و اجرای rotation/revoke/audit و failure-injection در deployment.
2. تکمیل Playwright و E2E providerهای واقعی.
3. تکمیل CI برای اجرای package-manager build در checkout disposable.
5. افزودن evaluation/dataset و tracing عمیق‌تر فقط بعد از تثبیت قراردادهای فعلی.
