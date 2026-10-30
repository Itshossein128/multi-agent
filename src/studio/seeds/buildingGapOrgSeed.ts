import path from "node:path";
import dotenv from "dotenv";
import { Pool, type PoolClient } from "pg";
import bcrypt from "bcryptjs";
import {
  createEdge,
  createEmptyDefinition,
  createNode,
  createLinearPipelineConfig,
  createHierarchicalSupervisorConfig,
  createRecursionGuard,
  type AgentRecord,
  type WorkflowDefinition,
} from "@multi-agent/types";
// Optional runtime validator if server compiler is available
function getWorkflowValidator(): ((workflow: any, agents: any, options: any, tools?: any) => any[]) | undefined {
  try {
    const serverValidationPath = "../../../apps/server/src/compiler/validation";
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (require(serverValidationPath) as { validateWorkflow?: any }).validateWorkflow;
  } catch {
    return undefined;
  }
}
import { leadOrchestratorPersona } from "../../agents/personas/leadOrchestrator";
import {
  qaVerifierPersona,
  gapEngineerPersona,
  QA_VERIFIER_PERSONA_ID,
  GAP_ENGINEER_PERSONA_ID,
} from "../../agents/personas/qaVerifier";

dotenv.config({ path: path.resolve(".env") });
dotenv.config({ path: path.resolve("apps/server/.env") });

export const SEED_TENANT_ID = "org-building-gap";
export const SEED_TENANT_SLUG = "building-gap";
export const SEED_TENANT_NAME = "Building Gap Delivery Org";
export const SEED_PROJECT_ID = "project-building-gap";
export const SEED_PROJECT_NAME = "Building Management Delivery Project";
export const SEED_WORKSPACE_ID = "ws-building-sandbox";
export const SEED_WORKSPACE_NAME = "Building Management Sandbox Workspace";
export const SEED_SANDBOX_ROOT = path.resolve("workspaces/building-management-sandbox");

export const LINEAR_PIPELINE_WORKFLOW_ID = "linear-spec-pipeline";
export const SUPERVISOR_WORKFLOW_ID = "supervisor-gap-delivery-workflow";

const now = new Date().toISOString();

// Specialist Agents
export const seedSpecialistAgents: AgentRecord[] = [
  // 1. Spec Delivery Lead Orchestrator
  {
    ...leadOrchestratorPersona,
    id: "agent-lead-orchestrator",
    tenantId: SEED_TENANT_ID,
    ownerId: "dev-user",
    tools: ["studio_task_tool"],
    metadata: {
      archetype: "hierarchical-supervisor",
      role: "supervisor",
      tenant: SEED_TENANT_ID,
    },
  },
  // Alias for lead orchestrator
  {
    ...leadOrchestratorPersona,
    id: "spec-delivery-lead-orchestrator",
    tenantId: SEED_TENANT_ID,
    ownerId: "dev-user",
    tools: ["studio_task_tool"],
    metadata: {
      archetype: "hierarchical-supervisor",
      role: "supervisor",
      tenant: SEED_TENANT_ID,
    },
  },
  // 2. Spec & Code Gap Auditor
  {
    id: "agent-gap-auditor",
    name: "Spec & Code Gap Auditor",
    description: "Deeply compares atomic specs against the sandbox codebase, computing completeness score and identifying specific missing files and endpoints.",
    backend: {
      type: "cli",
      provider: "codex",
      executable: "codex",
      args: ["--sandbox", "workspace-read"],
    },
    systemPrompt: `You are the Spec & Code Gap Auditor. Compare atomic specs against the sandbox repository (${SEED_SANDBOX_ROOT}). Compute completeness score 0-100%, check acceptance criteria, and return structured SpecAuditResultPayload findings.`,
    tools: [],
    enabled: true,
    executionPolicy: {
      shell: "restricted",
      filesystem: "read",
      network: false,
      workspaceRoot: SEED_SANDBOX_ROOT,
      allowedCommands: ["codex", "git", "pnpm"],
    },
    metadata: { role: "auditor", tenant: SEED_TENANT_ID },
    ownerId: "dev-user",
    tenantId: SEED_TENANT_ID,
    isSystem: false,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "spec-code-auditor",
    name: "Spec & Code Gap Auditor (Alias)",
    description: "Deeply compares atomic specs against the sandbox codebase.",
    backend: {
      type: "cli",
      provider: "codex",
      executable: "codex",
      args: ["--sandbox", "workspace-read"],
    },
    systemPrompt: "Audit sandbox code against atomic specs.",
    tools: [],
    enabled: true,
    executionPolicy: {
      shell: "restricted",
      filesystem: "read",
      network: false,
      workspaceRoot: SEED_SANDBOX_ROOT,
    },
    metadata: { role: "auditor", tenant: SEED_TENANT_ID },
    ownerId: "dev-user",
    tenantId: SEED_TENANT_ID,
    isSystem: false,
    createdAt: now,
    updatedAt: now,
  },
  // 3. Gap Report Consolidator
  {
    id: "agent-gap-consolidator",
    name: "Gap Report Consolidator",
    description: "Synthesizes individual spec audits into an executive gap matrix and remediation roadmap across all queued stories.",
    backend: {
      type: "cli",
      provider: "codex",
      executable: "codex",
      args: ["--sandbox", "workspace-read"],
    },
    systemPrompt: `You are the Gap Report Consolidator. Aggregate individual spec audit findings across all queued tasks into a ConsolidatedGapReport with totalUserStories, auditedCount, averageCompletenessScore, criticalGapsCount, and remediation plan summary.`,
    tools: [],
    enabled: true,
    executionPolicy: {
      shell: "restricted",
      filesystem: "read",
      network: false,
      workspaceRoot: SEED_SANDBOX_ROOT,
    },
    metadata: { role: "consolidator", tenant: SEED_TENANT_ID },
    ownerId: "dev-user",
    tenantId: SEED_TENANT_ID,
    isSystem: false,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "gap-report-consolidator",
    name: "Gap Report Consolidator (Alias)",
    description: "Synthesizes spec audits into executive gap matrix.",
    backend: {
      type: "cli",
      provider: "codex",
      executable: "codex",
      args: ["--sandbox", "workspace-read"],
    },
    systemPrompt: "Synthesize gap audits.",
    tools: [],
    enabled: true,
    executionPolicy: {
      shell: "restricted",
      filesystem: "read",
      network: false,
      workspaceRoot: SEED_SANDBOX_ROOT,
    },
    metadata: { role: "consolidator", tenant: SEED_TENANT_ID },
    ownerId: "dev-user",
    tenantId: SEED_TENANT_ID,
    isSystem: false,
    createdAt: now,
    updatedAt: now,
  },
  // 4. Gap Implementation Engineer
  {
    ...gapEngineerPersona,
    id: "agent-gap-engineer",
    tenantId: SEED_TENANT_ID,
    ownerId: "dev-user",
  },
  {
    ...gapEngineerPersona,
    id: GAP_ENGINEER_PERSONA_ID,
    tenantId: SEED_TENANT_ID,
    ownerId: "dev-user",
  },
  // 5. Delivery QA Verifier
  {
    ...qaVerifierPersona,
    id: "agent-qa-verifier",
    tenantId: SEED_TENANT_ID,
    ownerId: "dev-user",
  },
  {
    ...qaVerifierPersona,
    id: QA_VERIFIER_PERSONA_ID,
    tenantId: SEED_TENANT_ID,
    ownerId: "dev-user",
  },
];

// Tool record for studio_task_tool
export const studioTaskToolRecord = {
  id: "studio_task_tool",
  name: "studio_task_tool",
  category: "function",
  description: "Programmatic task board management tool: query, update status, assign agents, add comments.",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  configuration: {},
  enabled: true,
  impact: "write",
  executionPolicy: {
    requiresApproval: false,
    idempotency: "optional",
    retryable: true,
  },
  metadata: { tenant: SEED_TENANT_ID },
  createdAt: now,
  updatedAt: now,
};

// 42 Building Management User Stories (37 Atomic Specs + 5 Decision Framework Tasks)
export interface SeedTaskDefinition {
  id: string;
  specCode: string;
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  specFile?: string;
}

export const SEED_42_USER_STORIES: SeedTaskDefinition[] = [
  // 1-16: SPEC-01 to SPEC-04 (Daily Reports)
  {
    id: "task-us-dr-01",
    specCode: "US-DR-01",
    title: "US-DR-01: ثبت و پایش شرایط آب‌وهوایی و دما",
    description: "ثبت شرایط آب‌وهوا (آفتابی، بارانی، برفی، یخبندان)، دمای صبح و عصر، و باد با اعتبارسنجی بازه مجاز (-۴۰ تا +۶۰ درجه سانتی‌گراد).",
    priority: "high",
    specFile: "SPEC-01-DAILY-HEADER-WEATHER.md",
  },
  {
    id: "task-us-dr-02",
    specCode: "US-DR-02",
    title: "US-DR-02: مدیریت شیفت‌های کاری و وضعیت عملیاتی کارگاه",
    description: "مدیریت شیفت‌های کاری (روز، شب، نوبت‌کاری) و وضعیت عملیاتی کارگاه با دلایل تعطیلی و توقفات کاری.",
    priority: "high",
    specFile: "SPEC-01-DAILY-HEADER-WEATHER.md",
  },
  {
    id: "task-us-dr-03",
    specCode: "US-DR-03",
    title: "US-DR-03: اعمال قید یکتایی گزارش جاری (409 Conflict)",
    description: "جلوگیری از ایجاد گزارش تکراری در یک تاریخ و پروژه مشخص با بازگرداندن خطای 409 Conflict.",
    priority: "high",
    specFile: "SPEC-01-DAILY-HEADER-WEATHER.md",
  },
  {
    id: "task-us-dr-04",
    specCode: "US-DR-04",
    title: "US-DR-04: ثبت فعالیت‌های اجرایی روزانه متصل به WBS",
    description: "ثبت فعالیت‌های اجرایی روزانه متصل به ساختار شکست کار (WBS)، زون، بلوک، طبقه و مقادیر انجام‌شده.",
    priority: "high",
    specFile: "SPEC-02-DAILY-SECTIONS-GRID.md",
  },
  {
    id: "task-us-dr-05",
    specCode: "US-DR-05",
    title: "US-DR-05: ثبت نیروی انسانی ستادی (۳۴ شغل) و مستقیم (۳۲ شغل)",
    description: "ثبت دقیق نفر-ساعت و تعداد پرسنل ستادی و اجرایی به تفکیک عناوین شغلی استاندارد.",
    priority: "high",
    specFile: "SPEC-02-DAILY-SECTIONS-GRID.md",
  },
  {
    id: "task-us-dr-06",
    specCode: "US-DR-06",
    title: "US-DR-06: ثبت ساعات کارکرد و توقفات ماشین‌آلات",
    description: "ثبت ساعات فعال، آماده‌به‌کار و خرابی ماشین‌آلات سبک و سنگین کارگاه با کدینگ تجهیزات.",
    priority: "medium",
    specFile: "SPEC-02-DAILY-SECTIONS-GRID.md",
  },
  {
    id: "task-us-dr-07",
    specCode: "US-DR-07",
    title: "US-DR-07: ثبت مصالح کارگاه و مغایرت‌گیری با حواله‌های انبار",
    description: "ثبت مصالح وارده و مصرفی روزانه با انطباق اتوماتیک با حواله‌های انبار و بارنامه‌ها.",
    priority: "medium",
    specFile: "SPEC-02-DAILY-SECTIONS-GRID.md",
  },
  {
    id: "task-us-dr-08",
    specCode: "US-DR-08",
    title: "US-DR-08: ثبت تخصصی احجام بتن‌ریزی کارگاه (Concrete Logs)",
    description: "ثبت تراک، رده مقاومتی، اسلامپ، آزمایش نمونه، مواد افزودنی و پارت‌های بتن‌ریزی.",
    priority: "high",
    specFile: "SPEC-02-DAILY-SECTIONS-GRID.md",
  },
  {
    id: "task-us-dr-09",
    specCode: "US-DR-09",
    title: "US-DR-09: ثبت حوادث ایمنی، دستورکارها و موانع کاری با مسئول",
    description: "ثبت گزارش رویدادهای HSE، موانع اجرایی، مکاتبات فوری و تعیین مهندسین مسئول اقدام.",
    priority: "medium",
    specFile: "SPEC-02-DAILY-SECTIONS-GRID.md",
  },
  {
    id: "task-us-dr-10",
    specCode: "US-DR-10",
    title: "US-DR-10: الصاق تصاویر و مستندات میدانی به تفکیک فعالیت",
    description: "بارگذاری عکس‌ها و مدارک کارگاهی همراه با متادیتا، موقعیت مکانی و برچسب فعالیت WBS.",
    priority: "medium",
    specFile: "SPEC-02-DAILY-SECTIONS-GRID.md",
  },
  {
    id: "task-us-dr-11",
    specCode: "US-DR-11",
    title: "US-DR-11: گردش کار چندمرحله‌ای تأیید و رد گزارش روزانه",
    description: "فرآیند چرخه حیات گزارش روزانه از پیش‌نویس (Draft) تا بررسی (Review)، تأیید نهایی یا رد با ذکر دلایل.",
    priority: "high",
    specFile: "SPEC-03-DAILY-LIFECYCLE-LOCK.md",
  },
  {
    id: "task-us-dr-12",
    specCode: "US-DR-12",
    title: "US-DR-12: قفل شدن خودکار گزارش پس از تأیید نهایی (Lock)",
    description: "قفل شدن کامل ویرایش پس از تأیید سرپرست کارگاه و دستگاه نظارت.",
    priority: "high",
    specFile: "SPEC-03-DAILY-LIFECYCLE-LOCK.md",
  },
  {
    id: "task-us-dr-13",
    specCode: "US-DR-13",
    title: "US-DR-13: درخواست اصلاح گزارش قفل‌شده و نسخه‌بندی (Lineage)",
    description: "درخواست رسمی بازگشایی گزارش قفل‌شده همراه با نگهداری تاریخچه تغییرات و سلسله‌مراتب نسخه‌ها.",
    priority: "medium",
    specFile: "SPEC-03-DAILY-LIFECYCLE-LOCK.md",
  },
  {
    id: "task-us-dr-14",
    specCode: "US-DR-14",
    title: "US-DR-14: تمایز صریح میان مقدار صفر (0.00) و ثبت‌نشده (Unset)",
    description: "تمایز مقادیر صریح صفر و مقادیر ثبت‌نشده (null/undefined) در محاسبات پیشرفت و رکوردهای کارگاهی.",
    priority: "high",
    specFile: "SPEC-03-DAILY-LIFECYCLE-LOCK.md",
  },
  {
    id: "task-us-dr-15",
    specCode: "US-DR-15",
    title: "US-DR-15: ثبت محلی آفلاین ردیف‌ها با Client UUID",
    description: "امکان ثبت آفلاین داده‌ها در مرورگر با کلید یکتای سمت کلاینت (Client UUID) و ماندگاری IndexedDB.",
    priority: "high",
    specFile: "SPEC-04-DAILY-OFFLINE-SYNC.md",
  },
  {
    id: "task-us-dr-16",
    specCode: "US-DR-16",
    title: "US-DR-16: همگام‌سازی دسته‌ای (Sync Batch) و حل تعارضات",
    description: "ارسال دسته‌ای ردیف‌های آفلاین به سرور، مدیریت تداخل همزمانی و همگام‌سازی دوطرفه بدون از دست رفتن داده.",
    priority: "high",
    specFile: "SPEC-04-DAILY-OFFLINE-SYNC.md",
  },

  // 17-20: SPEC-05 (Discipline Sub-Reports)
  {
    id: "task-us-sr-01",
    specCode: "US-SR-01",
    title: "US-SR-01: ثبت ساب‌ریپورت تخصصی ابنیه و سازه (Civil)",
    description: "ثبت جزئیات اجرایی قالب‌بندی، آرماتوربندی، بتن‌ریزی و عملیات خاکی واحد ابنیه.",
    priority: "high",
    specFile: "SPEC-05-DISCIPLINE-SUB-REPORTS.md",
  },
  {
    id: "task-us-sr-02",
    specCode: "US-SR-02",
    title: "US-SR-02: ثبت ساب‌ریپورت تخصصی تأسیسات برقی (Electrical)",
    description: "ثبت لوله‌گذاری، سیم‌کشی، سینی کابل، تابلوهای برق و تجهیزات الکتریکی واحد برق.",
    priority: "medium",
    specFile: "SPEC-05-DISCIPLINE-SUB-REPORTS.md",
  },
  {
    id: "task-us-sr-03",
    specCode: "US-SR-03",
    title: "US-SR-03: ثبت ساب‌ریپورت تأسیسات مکانیکی، لوله‌کشی و HVAC",
    description: "ثبت اجرای لوله‌کشی آب، فاضلاب، اطفاء حریق، کانال‌کشی و چیلرها/فن‌کویل‌ها.",
    priority: "medium",
    specFile: "SPEC-05-DISCIPLINE-SUB-REPORTS.md",
  },
  {
    id: "task-us-sr-04",
    specCode: "US-SR-04",
    title: "US-SR-04: اعتبارسنجی و چرخه ارسال/تأیید ساب‌ریپورت‌های دیسیپلین",
    description: "ارسال ساب‌ریپورت به ناظر مقیم دیسیپلین، تأیید و آماده‌سازی برای تجمیع روزانه.",
    priority: "medium",
    specFile: "SPEC-05-DISCIPLINE-SUB-REPORTS.md",
  },

  // 21-26: SPEC-06 (Auto Daily Rollup)
  {
    id: "task-us-ag-01",
    specCode: "US-AG-01",
    title: "US-AG-01: حذف دکمه گزارش جدید و دسترسی با اندپوینت by-date",
    description: "انتقال معماری به دسترسی تقویم‌محور و بارگذاری گزارش بر اساس تاریخ انتخابی (/api/reports/by-date/).",
    priority: "high",
    specFile: "SPEC-06-AUTO-DAILY-ROLLUP.md",
  },
  {
    id: "task-us-ag-02",
    specCode: "US-AG-02",
    title: "US-AG-02: تجمیع خودکار فعالیت‌ها، نفرات و مصالح (Auto-Rollup)",
    description: "موتور تجمیع پس‌زمینه که به صورت خودکار رکوردهای ساب‌ریپورت‌ها را در شیت روزانه کارگاه تلفیق می‌کند.",
    priority: "high",
    specFile: "SPEC-06-AUTO-DAILY-ROLLUP.md",
  },
  {
    id: "task-us-ag-03",
    specCode: "US-AG-03",
    title: "US-AG-03: قفل‌گذاری ردیف‌های مشتق‌شده (Read-Only Derived Rows)",
    description: "ردیف‌های حاصل از تجمیع ساب‌ریپورت‌ها به صورت فقط‌خواندنی قفل شده و منبع داده نمایش داده می‌شود.",
    priority: "medium",
    specFile: "SPEC-06-AUTO-DAILY-ROLLUP.md",
  },
  {
    id: "task-us-ag-04",
    specCode: "US-AG-04",
    title: "US-AG-04: مدیریت شرایط جوی ترکیبی و بازنویسی دستی مدیر",
    description: "تعیین وضعیت جوی غالب و امکان بازنویسی رسمی شرایط اضطراری توسط سرپرست پروژه.",
    priority: "medium",
    specFile: "SPEC-06-AUTO-DAILY-ROLLUP.md",
  },
  {
    id: "task-us-ag-05",
    specCode: "US-AG-05",
    title: "US-AG-05: نمایش بنر نقص اطلاعات و دیسیپلین‌های غایب",
    description: "نمایش خودکار هشدار برای واحدهایی که تا پایان شیفت ساب‌ریپورت خود را ثبت نکرده‌اند.",
    priority: "medium",
    specFile: "SPEC-06-AUTO-DAILY-ROLLUP.md",
  },
  {
    id: "task-us-ag-06",
    specCode: "US-AG-06",
    title: "US-AG-06: به‌روزرسانی بلادرنگ بانک جامع فعالیت‌ها (ACTIVITY Log)",
    description: "ثبت بلادرنگ تمامی تغییرات و فعالیت‌ها در لاگ حسابرسی تغییرات دیتابیس.",
    priority: "medium",
    specFile: "SPEC-06-AUTO-DAILY-ROLLUP.md",
  },

  // 27-33: SPEC-07 & SPEC-08 (Progress Measurement & Periodic Rollup)
  {
    id: "task-us-pr-01",
    specCode: "US-PR-01",
    title: "US-PR-01: پیکربندی و اعتبارسنجی روش اندازه‌گیری فیزیکی فعالیت",
    description: "پیکربندی روش اندازه‌گیری (واحد حجمی، درصدی، وزن‌دهی اوزان WBS، گام‌های milestones).",
    priority: "high",
    specFile: "SPEC-07-PHYSICAL-PROGRESS-MEASUREMENT.md",
  },
  {
    id: "task-us-pr-02",
    specCode: "US-PR-02",
    title: "US-PR-02: محاسبه و تفکیک پیشرفت ۴ گانه (Four-Way Progress)",
    description: "تفکیک دقیق پیشرفت برنامه‌ای (Planned)، واقعی تجمعی (Actual Cumulative)، دوره جاری و پیش‌بینی (Forecast).",
    priority: "high",
    specFile: "SPEC-07-PHYSICAL-PROGRESS-MEASUREMENT.md",
  },
  {
    id: "task-us-pr-03",
    specCode: "US-PR-03",
    title: "US-PR-03: ممانعت از پیشرفت بالای ۱۰۰ درصد و الزام تأیید ناظر",
    description: "جلوگیری قاطعانه از ثبت پیشرفت بالای ۱۰۰٪ برای هر فعالیت و الزام تأیید کتبی ناظر برای احجام اضافی.",
    priority: "high",
    specFile: "SPEC-07-PHYSICAL-PROGRESS-MEASUREMENT.md",
  },
  {
    id: "task-us-pr-04",
    specCode: "US-PR-04",
    title: "US-PR-04: تولید خودکار گزارش هفتگی کارگاه از رکوردهای روزانه",
    description: "تولید خودکار گزارش هفتگی شامل تجمیع احجام، نفر-ساعت و پیشرفت فیزیکی از روزهای هفته.",
    priority: "high",
    specFile: "SPEC-08-PERIODIC-REPORTS-ROLLUP.md",
  },
  {
    id: "task-us-pr-05",
    specCode: "US-PR-05",
    title: "US-PR-05: تولید خودکار گزارش ماهانه جامع وضعیت پروژه",
    description: "گزارش وضعیت ماهانه مدیریتی، نمودارهای پیشرفت S-Curve، انحرافات زمانی و ریالی.",
    priority: "high",
    specFile: "SPEC-08-PERIODIC-REPORTS-ROLLUP.md",
  },
  {
    id: "task-us-pr-06",
    specCode: "US-PR-06",
    title: "US-PR-06: ثبت و استعلام ردپای ارقام (Figure Provenance)",
    description: "ردگیری اینکه هر عدد در گزارش دوره‌ای دقیقا از کدام گزارش روزانه و کدام ردیف مشتق شده است.",
    priority: "high",
    specFile: "SPEC-08-PERIODIC-REPORTS-ROLLUP.md",
  },
  {
    id: "task-us-pr-07",
    specCode: "US-PR-07",
    title: "US-PR-07: فرآیند ممیزی و بازنویسی کنترل‌شده ارقام (Figure Override)",
    description: "فرآیند بازنویسی ارقام در سطوح بالا با ثبت سند توجیهی و امضای الکترونیک مدیر پروژه.",
    priority: "medium",
    specFile: "SPEC-08-PERIODIC-REPORTS-ROLLUP.md",
  },

  // 34-36: SPEC-09 (Department Activity Reports)
  {
    id: "task-us-dp-01",
    specCode: "US-DP-01",
    title: "US-DP-01: ثبت رکوردهای روزانه دپارتمان و اکسل روزانه واحد",
    description: "ثبت لاگ فعالیت روزانه دپارتمان‌های ۵ گانه پروژه و ورود مستقیم از فایل شیت اکسل.",
    priority: "medium",
    specFile: "SPEC-09-DEPARTMENT-ACTIVITY-REPORTS.md",
  },
  {
    id: "task-us-dp-02",
    specCode: "US-DP-02",
    title: "US-DP-02: تجمیع و دانلود گزارش هفتگی اکسل دپارتمان",
    description: "تولید خروجی استاندارد اکسل هفتگی به تفکیک دپارتمان با فرمول‌های تجمیعی.",
    priority: "medium",
    specFile: "SPEC-09-DEPARTMENT-ACTIVITY-REPORTS.md",
  },
  {
    id: "task-us-dp-03",
    specCode: "US-DP-03",
    title: "US-DP-03: ورود و خروج دسته‌ای داده‌های دپارتمان از طریق اکسل",
    description: "امکان بارگذاری فله‌ای سوابق با فرمت .xlsx و استخراج گزارشات تطبیقی.",
    priority: "medium",
    specFile: "SPEC-09-DEPARTMENT-ACTIVITY-REPORTS.md",
  },

  // 37-38: SPEC-10 (Warehouse Department Reports)
  {
    id: "task-us-wh-01",
    specCode: "US-WH-01",
    title: "US-WH-01: ثبت گردش مصالح انبار با فیلدهای تخصصی ۸ گانه",
    description: "ثبت دریافت، مصرف، انتقال، مرجوعی و ضایعات مصالح با فیلدهای تخصصی موجودی انبار.",
    priority: "high",
    specFile: "SPEC-10-WAREHOUSE-DEPARTMENT-REPORTS.md",
  },
  {
    id: "task-us-wh-02",
    specCode: "US-WH-02",
    title: "US-WH-02: صدور گزارش روزانه، هفتگی و بالانس تجمعی انبار",
    description: "صدور کاردکس کالا، تراز مصالح و گزارش مغایرت‌های مصرف اسمی در برابر واقعی.",
    priority: "medium",
    specFile: "SPEC-10-WAREHOUSE-DEPARTMENT-REPORTS.md",
  },

  // 39-42: SPEC-11 (Shiraz Excel Parity & Decision Framework)
  {
    id: "task-us-ex-01",
    specCode: "US-EX-01",
    title: "US-EX-01: انطباق کامل خروجی گزارش روزانه با ساختار FILE 4 شیراز",
    description: "تولید شیت اکسل منطبق با نمونه فرمت کارگاهی شیراز همراه با تمامی سلول‌ها و فرمول‌ها.",
    priority: "high",
    specFile: "SPEC-11-SHIRAZ-EXCEL-PARITY-PDF.md",
  },
  {
    id: "task-us-ex-02",
    specCode: "US-EX-02",
    title: "US-EX-02: انطباق ساب‌ریپورت‌های ابنیه و برق با شیت‌های FILE 5 و 6",
    description: "فرمت اکسل خروجی برای ساب‌ریپورت‌های تخصصی دقیقا مطابق با شیت‌های ۵ و ۶ شیراز.",
    priority: "medium",
    specFile: "SPEC-11-SHIRAZ-EXCEL-PARITY-PDF.md",
  },
  {
    id: "task-us-ex-03",
    specCode: "US-EX-03",
    title: "US-EX-03: صدور خروجی چاپی و PDF رسمی با الصاق امضاها",
    description: "تولید PDF استاندارد A4 افقی با استایل گرافیکی رسمی، جانمایی امضاهای دیجیتال و مهر پروژه.",
    priority: "high",
    specFile: "SPEC-11-SHIRAZ-EXCEL-PARITY-PDF.md",
  },
  {
    id: "task-us-ex-04",
    specCode: "US-EX-04",
    title: "US-EX-04: فیلترهای چندبعدی گزارش‌گیری در کلیه صفحات",
    description: "فیلتر بر اساس بازه زمانی، زون، سرپرست کارگاه، وضعیت تأیید و کلمات کلیدی در تمام صفحات گزارشات.",
    priority: "medium",
    specFile: "SPEC-11-SHIRAZ-EXCEL-PARITY-PDF.md",
  },

  // Decision Framework Core Tasks (completing 42 total)
  {
    id: "task-us-dec-01",
    specCode: "US-DEC-01",
    title: "US-DEC-01: چارچوب تصمیم‌گیری معماری و مدل داده هسته گزارش روزانه",
    description: "تثبیت معماری مدل داده‌های PostgreSQL و روابط یکپارچه گزارش روزانه با زیرسیستم‌ها.",
    priority: "high",
  },
  {
    id: "task-us-dec-02",
    specCode: "US-DEC-02",
    title: "US-DEC-02: موتور انطباق و اعتبارسنجی قوانین تجاری و قفل‌گذاری گزارشات",
    description: "پیاده‌سازی گیت‌های اعتبارسنجی قوانین تجاری کارگاه و سیاست قفل دائم گزارشات نهایی.",
    priority: "high",
  },
  {
    id: "task-us-dec-03",
    specCode: "US-DEC-03",
    title: "US-DEC-03: موتور تجمیع سلسله‌مراتبی داده‌ها و خط سیر ردپای ارقام",
    description: "پیاده‌سازی پایپ‌لاین رول‌آپ ارقام از ساب‌ریپورت به روزانه و دوره‌ای با حفظ تاریخچه ارقام.",
    priority: "high",
  },
  {
    id: "task-us-dec-04",
    specCode: "US-DEC-04",
    title: "US-DEC-04: چارچوب همگام‌سازی آفلاین، کش محلی و حل تعارضات توزیع‌شده",
    description: "پیاده‌سازی موتور ذخیره‌سازی محلی آفلاین کلاینت و رفع تداخل داده‌ها در زمان اتصال.",
    priority: "high",
  },
  {
    id: "task-us-dec-05",
    specCode: "US-DEC-05",
    title: "US-DEC-05: موتور یکپارچه‌سازی و تطابق خروجی اکسل/PDF با استانداردهای سازمانی",
    description: "تضمین انطباق کامل و ۱۰۰٪ شیت‌های اکسل و خروجی‌های PDF با فرم‌های اداری و سازمانی پروژه.",
    priority: "high",
  },
];

// Helper to construct Linear Pipeline workflow definition
export function createSeededLinearWorkflow(): WorkflowDefinition {
  const input = createNode("input", { x: 50, y: 200 });
  input.id = "intake-input";
  input.config = { inputKey: "spec_code", description: "Target specification or task ID to audit and implement" };

  const auditor = createNode("agent", { x: 300, y: 200 }, { agentId: "agent-gap-auditor" });
  auditor.id = "node-gap-auditor";

  const consolidator = createNode("agent", { x: 550, y: 200 }, { agentId: "agent-gap-consolidator" });
  consolidator.id = "node-gap-consolidator";

  const approval = createNode("approval", { x: 800, y: 200 });
  approval.id = "human-approval-gate";
  approval.config = {
    message: "Confirm Consolidated Gap Report before authorizing sandbox implementation.",
    approvalType: "manual",
    timeoutSeconds: 86400,
  };

  const engineer = createNode("agent", { x: 1050, y: 200 }, { agentId: "agent-gap-engineer" });
  engineer.id = "node-gap-engineer";

  const qa = createNode("agent", { x: 1300, y: 200 }, { agentId: "agent-qa-verifier" });
  qa.id = "node-qa-verifier";

  const output = createNode("output", { x: 1550, y: 200 });
  output.id = "pipeline-output";
  output.config = { outputKey: "delivery_packet", description: "Final verified deliverables and closed gaps" };

  return {
    ...createEmptyDefinition(),
    id: LINEAR_PIPELINE_WORKFLOW_ID,
    name: "Linear Spec-to-Code Pipeline",
    schemaVersion: 2,
    archetype: "linear-pipeline",
    archetypeConfig: createLinearPipelineConfig(),
    tenantId: SEED_TENANT_ID,
    ownerId: "dev-user",
    nodes: [input, auditor, consolidator, approval, engineer, qa, output],
    edges: [
      createEdge({ source: input.id, target: auditor.id }),
      createEdge({ source: auditor.id, target: consolidator.id }),
      createEdge({ source: consolidator.id, target: approval.id }),
      createEdge({ source: approval.id, target: engineer.id }),
      createEdge({ source: engineer.id, target: qa.id }),
      createEdge({ source: qa.id, target: output.id }),
    ],
    updatedAt: now,
  };
}

// Helper to construct Hierarchical Supervisor workflow definition
export function createSeededSupervisorWorkflow(): WorkflowDefinition {
  const input = createNode("input", { x: 50, y: 250 });
  input.id = "intake-input";
  input.config = { inputKey: "directive", description: "Studio Kanban task intake or batch feature directive" };

  const supervisor = createNode("agent", { x: 300, y: 250 }, { agentId: "agent-lead-orchestrator" });
  supervisor.id = "node-lead-orchestrator";

  const conditionRouter = createNode("condition", { x: 550, y: 250 });
  conditionRouter.id = "supervisor-condition-router";
  conditionRouter.config = {
    branches: [
      { key: "audit_spec", label: "Audit Codebase" },
      { key: "consolidate", label: "Consolidate Gaps" },
      { key: "await_approval", label: "Request Human Approval" },
      { key: "implement_spec", label: "Remediate Gaps" },
      { key: "qa_verify", label: "Verify QA" },
      { key: "complete", label: "Complete Run" },
      { key: "loop_limit_exceeded", label: "Recursion Limit Exceeded" },
    ],
    valueSource: "last_value",
    valueField: "nextAction",
    unknownRoute: "loop_limit_exceeded",
  };

  const auditor = createNode("agent", { x: 800, y: 50 }, { agentId: "agent-gap-auditor", role: "gap_auditor" });
  auditor.id = "node-gap-auditor";

  const consolidator = createNode("agent", { x: 800, y: 150 }, { agentId: "agent-gap-consolidator" });
  consolidator.id = "node-gap-consolidator";

  const approval = createNode("approval", { x: 800, y: 250 });
  approval.id = "human-approval-gate";
  approval.config = {
    message: "Review Consolidated Gap Report and approve code implementation in sandbox.",
    approvalType: "manual",
    timeoutSeconds: 86400,
  };

  const engineer = createNode("agent", { x: 800, y: 350 }, { agentId: "agent-gap-engineer", mutatesCode: true });
  engineer.id = "node-gap-engineer";

  const qa = createNode("agent", { x: 800, y: 450 }, { agentId: "agent-qa-verifier" });
  qa.id = "node-qa-verifier";

  const loopFallback = createNode("memory", { x: 800, y: 550 });
  loopFallback.id = "loop_limit_exceeded";
  loopFallback.config = {
    memoryType: "short_term",
    mode: "write",
    key: "loop_limit_exceeded",
  };

  const output = createNode("output", { x: 1100, y: 250 });
  output.id = "pipeline-output";
  output.config = { outputKey: "delivery_result", description: "Final delivery results and verified tasks" };

  return {
    ...createEmptyDefinition(),
    id: SUPERVISOR_WORKFLOW_ID,
    name: "Hierarchical Supervisor Workflow",
    schemaVersion: 2,
    archetype: "hierarchical-supervisor",
    archetypeConfig: createHierarchicalSupervisorConfig(supervisor.id, {
      recursionGuards: [
        createRecursionGuard("qa_verify->implement_spec", "loop_limit_exceeded", 3),
      ],
    }),
    tenantId: SEED_TENANT_ID,
    ownerId: "dev-user",
    nodes: [
      input,
      supervisor,
      conditionRouter,
      auditor,
      consolidator,
      approval,
      engineer,
      qa,
      loopFallback,
      output,
    ],
    edges: [
      createEdge({ source: input.id, target: supervisor.id }),
      createEdge({ source: supervisor.id, target: conditionRouter.id }),

      // Dynamic conditional routes from supervisor condition router
      createEdge({ source: conditionRouter.id, target: auditor.id, kind: "conditional", branchKey: "audit_spec" }),
      createEdge({ source: conditionRouter.id, target: consolidator.id, kind: "conditional", branchKey: "consolidate" }),
      createEdge({ source: conditionRouter.id, target: approval.id, kind: "conditional", branchKey: "await_approval" }),
      createEdge({ source: conditionRouter.id, target: approval.id, kind: "conditional", branchKey: "implement_spec" }),
      createEdge({ source: conditionRouter.id, target: qa.id, kind: "conditional", branchKey: "qa_verify" }),
      createEdge({ source: conditionRouter.id, target: output.id, kind: "conditional", branchKey: "complete" }),
      createEdge({ source: conditionRouter.id, target: loopFallback.id, kind: "conditional", branchKey: "loop_limit_exceeded" }),

      // The approval gate is the only entrance to code mutation.
      createEdge({ source: approval.id, target: engineer.id, kind: "conditional", branchKey: "approved" }),
      createEdge({ source: approval.id, target: output.id, kind: "conditional", branchKey: "rejected" }),
      createEdge({ source: approval.id, target: supervisor.id, kind: "conditional", branchKey: "needs_clarification" }),

      // Feedback routes cycling back to supervisor
      createEdge({ source: auditor.id, target: supervisor.id }),
      createEdge({ source: consolidator.id, target: supervisor.id }),
      createEdge({ source: engineer.id, target: supervisor.id }),
      createEdge({ source: qa.id, target: supervisor.id }),
      createEdge({ source: loopFallback.id, target: output.id }),
    ],
    updatedAt: now,
  };
}

export async function seedBuildingGapOrg(options?: {
  connectionString?: string;
  client?: PoolClient;
}): Promise<{
  tenantId: string;
  projectId: string;
  workspaceId: string;
  agentsCount: number;
  workflowsCount: number;
  tasksCount: number;
}> {
  const connectionString =
    options?.connectionString ??
    process.env.MEMORY_DATABASE_URL ??
    process.env.MEMORY_TEST_DATABASE_URL ??
    "postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory";

  let client = options?.client;
  let ownedPool: Pool | undefined;

  if (!client) {
    ownedPool = new Pool({ connectionString });
    client = await ownedPool.connect();
  }

  try {
    await client.query("BEGIN");

    // Ensure session sets app.tenant_id for RLS bypass/satisfaction
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [SEED_TENANT_ID]);
    await client.query("SELECT set_config('app.principal_kind', 'user', false)");

    const passwordHash = await bcrypt.hash("Password123!", 10);

    // 1. Ensure user dev-user exists
    await client.query(`
      INSERT INTO studio_users (id, email, password_hash, display_name, tenant_id, status, created_at, updated_at)
      VALUES ('dev-user', 'dev@localhost', $1, 'Dev User', $2, 'active', now(), now())
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        updated_at = now()
    `, [passwordHash, SEED_TENANT_ID]);

    // 2. Ensure studio_organizations has org-building-gap
    await client.query(`
      INSERT INTO studio_organizations (id, name, description, config, owner_id, status, slug, created_by, created_at, updated_at)
      VALUES (
        $1, $2,
        'Autonomous Multi-Agent Organization for Spec-to-Code Gap Analysis, Quality Verification, and Remediation',
        '{}'::jsonb,
        'dev-user', 'active', $3, 'dev-user', now(), now()
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        slug = EXCLUDED.slug,
        status = 'active',
        updated_at = now()
    `, [SEED_TENANT_ID, SEED_TENANT_NAME, SEED_TENANT_SLUG]);

    // 3. Organization Membership
    await client.query(`
      INSERT INTO studio_organization_memberships (organization_id, user_id, role, status, invited_by, version, created_at, updated_at)
      VALUES ($1, 'dev-user', 'owner', 'active', 'system', 1, now(), now())
      ON CONFLICT DO NOTHING
    `, [SEED_TENANT_ID]);

    // 4. Studio Project
    await client.query(`
      INSERT INTO studio_projects (id, tenant_id, name, description, status, settings, owner_id, created_at, updated_at)
      VALUES (
        $1, $2, $3,
        'Target repository for civil construction daily field reports, periodic progress, and gap remediation',
        'active',
        jsonb_build_object('repository', '${SEED_SANDBOX_ROOT}'),
        'dev-user',
        now(),
        now()
      )
      ON CONFLICT (id) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        name = EXCLUDED.name,
        settings = EXCLUDED.settings,
        status = 'active',
        updated_at = now()
    `, [SEED_PROJECT_ID, SEED_TENANT_ID, SEED_PROJECT_NAME]);

    // 5. Studio Workspace
    await client.query(`
      INSERT INTO studio_workspaces (id, tenant_id, project_id, name, description, status, settings, owner_id, created_at, updated_at)
      VALUES (
        $1, $2, $3, $4,
        'Workspace for inspecting reports documentation, analyzing implementation gaps in building-management, and orchestrating remediation',
        'active',
        jsonb_build_object('storageRoot', '${SEED_SANDBOX_ROOT}', 'repository', '${SEED_SANDBOX_ROOT}'),
        'dev-user',
        now(),
        now()
      )
      ON CONFLICT (id) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        project_id = EXCLUDED.project_id,
        name = EXCLUDED.name,
        settings = EXCLUDED.settings,
        status = 'active',
        updated_at = now()
    `, [SEED_WORKSPACE_ID, SEED_TENANT_ID, SEED_PROJECT_ID, SEED_WORKSPACE_NAME]);

    // 6. Specialist Agents
    for (const agent of seedSpecialistAgents) {
      await client.query(`
        INSERT INTO studio_agents (id, tenant_id, name, record, owner_id, is_system, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'dev-user', false, now(), now())
        ON CONFLICT (id) DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          name = EXCLUDED.name,
          record = EXCLUDED.record,
          updated_at = now()
      `, [agent.id, SEED_TENANT_ID, agent.name, JSON.stringify(agent)]);
    }

    // 7. Tool Record: studio_task_tool (system tool available across tenants)
    await client.query(`
      INSERT INTO studio_tools (id, tenant_id, name, record, owner_id, is_system, created_at, updated_at)
      VALUES ($1, NULL, $2, $3, 'system', true, now(), now())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        record = EXCLUDED.record,
        updated_at = now()
    `, [
      studioTaskToolRecord.id,
      studioTaskToolRecord.name,
      JSON.stringify(studioTaskToolRecord),
    ]);

    // 8. Workflows (Linear & Supervisor)
    const validator = getWorkflowValidator();
    const linearWf = createSeededLinearWorkflow();
    if (validator) {
      const linearIssues = validator(linearWf, seedSpecialistAgents, {}, [studioTaskToolRecord as any]);
      const linearErrors = linearIssues.filter((i: any) => i.level === "error" || i.severity === "error");
      if (linearErrors.length > 0) {
        throw new Error(`Linear pipeline workflow validation failed: ${JSON.stringify(linearErrors)}`);
      }
    }

    await client.query(`
      INSERT INTO studio_workflows (id, tenant_id, name, definition, owner_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'dev-user', now(), now())
      ON CONFLICT (id) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        name = EXCLUDED.name,
        definition = EXCLUDED.definition,
        updated_at = now()
    `, [linearWf.id, SEED_TENANT_ID, linearWf.name, JSON.stringify(linearWf)]);

    const supervisorWf = createSeededSupervisorWorkflow();
    if (validator) {
      const supervisorIssues = validator(supervisorWf, seedSpecialistAgents, {}, [studioTaskToolRecord as any]);
      const supervisorErrors = supervisorIssues.filter((i: any) => i.level === "error" || i.severity === "error");
      if (supervisorErrors.length > 0) {
        throw new Error(`Supervisor workflow validation failed: ${JSON.stringify(supervisorErrors)}`);
      }
    }

    await client.query(`
      INSERT INTO studio_workflows (id, tenant_id, name, definition, owner_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'dev-user', now(), now())
      ON CONFLICT (id) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        name = EXCLUDED.name,
        definition = EXCLUDED.definition,
        updated_at = now()
    `, [supervisorWf.id, SEED_TENANT_ID, supervisorWf.name, JSON.stringify(supervisorWf)]);

    // 9. All 42 User Stories into studio_tasks
    for (const story of SEED_42_USER_STORIES) {
      await client.query(`
        INSERT INTO studio_tasks (
          id, tenant_id, project_id, workspace_id, title, description,
          priority, status, assigned_agent, assigned_agents, dependencies,
          retry_count, paused, metadata, owner_id, created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, 'queued', NULL, '[]'::jsonb, '[]'::jsonb,
          0, false, $8, 'dev-user', now(), now()
        )
        ON CONFLICT (id) DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          project_id = EXCLUDED.project_id,
          workspace_id = EXCLUDED.workspace_id,
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          priority = EXCLUDED.priority,
          status = 'queued',
          metadata = EXCLUDED.metadata,
          updated_at = now()
      `, [
        story.id,
        SEED_TENANT_ID,
        SEED_PROJECT_ID,
        SEED_WORKSPACE_ID,
        story.title,
        story.description,
        story.priority,
        JSON.stringify({
          specCode: story.specCode,
          specFile: story.specFile,
          seededAt: now,
        }),
      ]);
    }

    await client.query("COMMIT");

    return {
      tenantId: SEED_TENANT_ID,
      projectId: SEED_PROJECT_ID,
      workspaceId: SEED_WORKSPACE_ID,
      agentsCount: seedSpecialistAgents.length,
      workflowsCount: 2,
      tasksCount: SEED_42_USER_STORIES.length,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    if (ownedPool) {
      client.release();
      await ownedPool.end();
    }
  }
}

if (require.main === module) {
  seedBuildingGapOrg()
    .then((result) => {
      console.log("Successfully seeded building-gap org:", result);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Failed to seed building-gap org:", err);
      process.exit(1);
    });
}
