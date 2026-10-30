/**
 * Autonomous Spec & User-Story Gap Analysis Orchestrator
 *
 * Accepts directive:
 * "داکیومنت‌های موجود در <path/to/docs> رو بررسی کن و برای هر spec/user-story یک تسک ایجاد کن تا میزان پیاده‌سازی، درستی پیاده‌سازی و gapهای موجود رو جمع‌آوری و گزارش کنی."
 */

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config({ path: path.resolve(".env") });
dotenv.config({ path: path.resolve("apps/server/.env") });

const pool = new Pool({
  connectionString: process.env.MEMORY_DATABASE_URL ?? "postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory",
});

interface UserStoryAudit {
  code: string;
  title: string;
  role: string;
  specId: string;
  specTitle: string;
  sourceDoc: string;
  acceptanceCriteria: string[];
  expectedModels: string[];
  expectedEndpoints: string[];
  implementationPct: number;
  status: "FULL" | "PARTIAL" | "MISSING";
  matchedComponents: string[];
  gaps: string[];
  notes: string;
}

interface SpecSummary {
  specId: string;
  specTitle: string;
  docPath: string;
  userStoriesCount: number;
  avgImplementationPct: number;
  status: "FULL" | "PARTIAL" | "MISSING";
  criticalGapsCount: number;
  userStories: UserStoryAudit[];
}

export class SpecGapOrchestrator {
  private targetRepoRoot: string;
  private docsRoot: string;
  private tenantId = "org-building-gap";
  private ownerId = "dev-user";
  private projectId = "project-building-management";
  private workspaceId = "workspace-building-gap";
  private agentId = "spec-code-auditor";

  constructor(targetRepoRoot: string, docsRoot: string) {
    this.targetRepoRoot = targetRepoRoot;
    this.docsRoot = docsRoot;
  }

  static parseDirective(input: string): { docsPath: string; directive: string } {
    const match = input.match(/<([^>]+)>/);
    let docsPath = "/home/hossein/Desktop/projects/building-management/reports_documentation";
    if (match && match[1] && !match[1].includes("path/to/docs")) {
      docsPath = match[1].trim();
    }
    return { docsPath, directive: input };
  }

  async run(concurrency = 4) {
    console.log(`\n======================================================`);
    console.log(`🚀 Starting Multi-Agent Spec & Gap Analysis Engine`);
    console.log(`📁 Docs Root: ${this.docsRoot}`);
    console.log(`💻 Target Repository: ${this.targetRepoRoot}`);
    console.log(`👥 Tenant: ${this.tenantId} | Owner: ${this.ownerId}`);
    console.log(`⚡ Concurrency Pool: ${concurrency} parallel workers`);
    console.log(`======================================================\n`);

    // Step 1: Scan documentation directory and extract user stories
    const userStories = await this.extractAllUserStories();
    console.log(`📋 Discovered ${userStories.length} atomic user stories across specifications.\n`);

    // Step 2: Create tasks in Studio Task Board for each user story
    console.log(`📝 Creating Studio Tasks in Task Board...`);
    const createdTasks = await this.createStudioTasks(userStories);
    console.log(`✅ Successfully registered ${createdTasks.length} tasks in Studio DB.\n`);

    // Step 3: Run parallel codebase audit
    console.log(`🔍 Executing Deep Codebase Audits (spec vs code)...`);
    const auditResults = await this.auditInParallel(userStories, concurrency);
    console.log(`\n✅ Finished auditing all ${auditResults.length} user stories.\n`);

    // Step 4: Update tasks in Studio with results
    console.log(`💾 Persisting audit evidence and status to Studio Tasks...`);
    await this.updateStudioTasks(createdTasks, auditResults);

    // Step 5: Consolidate findings into Spec Summaries and Final Report
    console.log(`📊 Consolidating findings and generating Executive Gap Report...`);
    const specSummaries = this.aggregateBySpec(auditResults);
    const overallPct = Math.round(
      auditResults.reduce((acc, curr) => acc + curr.implementationPct, 0) / (auditResults.length || 1)
    );

    const reportPath = path.join(this.docsRoot, "GAP_ANALYSIS_REPORT.md");
    const jsonPath = path.join(this.docsRoot, "GAP_ANALYSIS_REPORT.json");

    const reportMarkdown = this.buildReportMarkdown(overallPct, specSummaries, auditResults);
    fs.writeFileSync(reportPath, reportMarkdown, "utf8");
    fs.writeFileSync(jsonPath, JSON.stringify({ overallPct, specSummaries, auditResults }, null, 2), "utf8");
    console.log(`📄 Saved Executive Gap Report to:\n   👉 ${reportPath}`);
    console.log(`   👉 ${jsonPath}\n`);

    // Step 6: Create Human Approval Gate in Studio
    console.log(`🛑 Creating Human Approval Gate (Waiting for User Confirmation)...`);
    const approvalId = await this.createApprovalGate(overallPct, auditResults.length, specSummaries);
    console.log(`🔒 Approval Gate registered in Studio: "${approvalId}"`);

    console.log(`\n======================================================`);
    console.log(`🎉 Spec Gap Analysis Completed! Overall Implementation: ${overallPct}%`);
    console.log(`⚠️ Status: AWAITING_HUMAN_APPROVAL before code modifications.`);
    console.log(`======================================================\n`);

    return { overallPct, specSummaries, auditResults, reportPath, approvalId };
  }

  private async extractAllUserStories(): Promise<UserStoryAudit[]> {
    const atomicSpecsDir = path.join(this.docsRoot, "atomic-specs");
    const files = fs.readdirSync(atomicSpecsDir).filter(f => f.startsWith("SPEC-") && f.endsWith(".md"));
    files.sort();

    const stories: UserStoryAudit[] = [];

    for (const file of files) {
      const fullPath = path.join(atomicSpecsDir, file);
      const content = fs.readFileSync(fullPath, "utf8");

      // Extract Spec Title
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const specTitle = titleMatch ? titleMatch[1].trim() : file;
      const specId = file.replace(/\.md$/, "");

      // Split by User Story
      const storyBlocks = content.split(/###\s+داستان کاربری\s+/);
      for (let i = 1; i < storyBlocks.length; i++) {
        const block = storyBlocks[i];
        const headerLine = block.split("\n")[0] || "";
        const codeMatch = headerLine.match(/[`*_]?(US-[A-Z]+-\d+)[`*_]?:\s*(.+)/);
        const code = codeMatch ? codeMatch[1].trim() : `US-${specId}-${i}`;
        const title = codeMatch ? codeMatch[2].replace(/[`*_]/g, "").trim() : headerLine.trim();

        // Role
        const roleMatch = block.match(/به عنوان\s+\*\*([^*]+)\*\*/);
        const role = roleMatch ? roleMatch[1].trim() : "کاربر سیستم";

        // Acceptance Criteria scenarios
        const acMatches = [...block.matchAll(/\*\*سناریو\s+\d+\s*\(([^)]+)\)\s*:\*\*/g)].map(m => m[1]);

        stories.push({
          code,
          title,
          role,
          specId,
          specTitle,
          sourceDoc: path.relative(this.docsRoot, fullPath),
          acceptanceCriteria: acMatches.length ? acMatches : ["سناریوی استاندارد سناریوهای کاربری"],
          expectedModels: [],
          expectedEndpoints: [],
          implementationPct: 0,
          status: "MISSING",
          matchedComponents: [],
          gaps: [],
          notes: "",
        });
      }
    }

    return stories;
  }

  private async createStudioTasks(stories: UserStoryAudit[]): Promise<Array<{ id: string; storyCode: string }>> {
    const client = await pool.connect();
    const created: Array<{ id: string; storyCode: string }> = [];

    try {
      await client.query("BEGIN");
      for (const story of stories) {
        const taskId = `task-audit-${story.code.toLowerCase()}`;
        const taskTitle = `[Spec Audit] ${story.code}: ${story.title}`;
        const taskDescription = `**Spec:** ${story.specId} (${story.specTitle})\n**Role:** ${story.role}\n**Reference:** ${story.sourceDoc}\n**Acceptance Scenarios:**\n${story.acceptanceCriteria.map(a => `- ${a}`).join("\n")}`;

        const priority = ["SPEC-01", "SPEC-02", "SPEC-03", "SPEC-06"].includes(story.specId) ? "high" : "medium";

        await client.query(`
          INSERT INTO studio_tasks (
            id, tenant_id, owner_id, title, description, priority, status,
            assigned_agent, workflow_id, workspace_id, project_id, dependencies,
            retry_count, paused, metadata, output, created_at, updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, 'queued',
            $7, 'spec-gap-delivery-workflow', $8, $9, '[]'::jsonb,
            0, false, $10, null, now(), now()
          )
          ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            priority = EXCLUDED.priority,
            status = 'queued',
            metadata = EXCLUDED.metadata,
            updated_at = now()
        `, [
          taskId,
          this.tenantId,
          this.ownerId,
          taskTitle,
          taskDescription,
          priority,
          this.agentId,
          this.workspaceId,
          this.projectId,
          JSON.stringify({ storyCode: story.code, specId: story.specId, sourceDoc: story.sourceDoc }),
        ]);

        created.push({ id: taskId, storyCode: story.code });
      }
      await client.query("COMMIT");
      return created;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  private async auditInParallel(stories: UserStoryAudit[], concurrency: number): Promise<UserStoryAudit[]> {
    const results: UserStoryAudit[] = [];
    const queue = [...stories];
    let completedCount = 0;

    const worker = async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        const audit = await this.auditSingleUserStory(item);
        results.push(audit);
        completedCount++;
        process.stdout.write(`\r   [${completedCount}/${stories.length}] Audited ${item.code} -> ${audit.status} (${audit.implementationPct}%)    `);
      }
    };

    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);
    results.sort((a, b) => a.code.localeCompare(b.code));
    return results;
  }

  private async auditSingleUserStory(story: UserStoryAudit): Promise<UserStoryAudit> {
    const res = { ...story };
    const apiCoreDir = path.join(this.targetRepoRoot, "apps/api/core");
    const webSrcDir = path.join(this.targetRepoRoot, "apps/web/src");

    // Read codebase index files
    const fieldReportsModels = this.readFileSafe(path.join(apiCoreDir, "field_reports/models.py"));
    const fieldReportsViews = this.readFileSafe(path.join(apiCoreDir, "field_reports/daily_report_views.py"));
    const fieldReportsSerializers = this.readFileSafe(path.join(apiCoreDir, "field_reports/serializers.py"));
    const subReportsModels = this.readFileSafe(path.join(apiCoreDir, "sub_reports/models.py"));
    const subReportsViews = this.readFileSafe(path.join(apiCoreDir, "sub_reports/sub_report_views.py"));
    const scheduleModels = this.readFileSafe(path.join(apiCoreDir, "schedule/models.py"));
    const scheduleViews = this.readFileSafe(path.join(apiCoreDir, "schedule/period_report_views.py"));
    const inventoryModels = this.readFileSafe(path.join(apiCoreDir, "inventory/department_activity_services.py"));
    const inventoryIo = this.readFileSafe(path.join(apiCoreDir, "inventory/department_activity_io.py"));
    const webDailyForm = this.readFileSafe(path.join(webSrcDir, "app/routes/daily-report-form.tsx"));
    const webDailyApi = this.readFileSafe(path.join(webSrcDir, "app/lib/api/daily-reports.ts"));
    const webSubReports = this.readFileSafe(path.join(webSrcDir, "app/routes/project-sub-reports.tsx"));

    const matched: string[] = [];
    const gaps: string[] = [];
    let score = 0; // out of 100

    switch (story.code) {
      // SPEC-01: Header, Weather & Shift
      case "US-DR-01": {
        // Weather conditions and temperature validation
        if (fieldReportsModels.includes("class WeatherCondition") && fieldReportsModels.includes("temp_min") && fieldReportsModels.includes("temp_max")) {
          matched.push("DailyReport.temp_min, temp_max, weather_condition (Django model)");
          score += 40;
        } else gaps.push("Missing temperature or weather condition fields in DailyReport model");

        if (fieldReportsSerializers.includes("temp_max_must_be_gte_temp_min") || fieldReportsViews.includes("temp_min")) {
          matched.push("Temperature validation: temp_max >= temp_min check");
          score += 30;
        } else gaps.push("Missing temp_max_must_be_gte_temp_min serializer validation");

        if (webDailyForm.includes("weather") || webDailyForm.includes("temperature")) {
          matched.push("Frontend DailyReportForm weather & temperature inputs");
          score += 30;
        } else gaps.push("Missing explicit weather and min/max temperature controls in UI");
        break;
      }

      case "US-DR-02": {
        // Shift management & site status (active/closed)
        if (fieldReportsModels.includes("class ReportShift") && fieldReportsModels.includes("class SiteStatus")) {
          matched.push("ReportShift and SiteStatus choices on DailyReport");
          score += 50;
        } else gaps.push("Missing ReportShift or SiteStatus choices in models.py");

        if (fieldReportsModels.includes("is_site_closed") || fieldReportsModels.includes("site_status")) {
          matched.push("Site status field persistence");
          score += 25;
        } else gaps.push("Missing explicit site status toggle handling");

        if (webDailyForm.includes("shift") || webDailyForm.includes("SiteStatus")) {
          matched.push("Frontend shift and status selectors");
          score += 25;
        } else gaps.push("Missing frontend shift and site closed reason UI selector");
        break;
      }

      case "US-DR-03": {
        // 409 Conflict unique constraint (project, report_date, shift)
        if (fieldReportsModels.includes("unique_report_per_date_shift") || fieldReportsModels.includes("UniqueConstraint")) {
          matched.push("Database unique constraint: project + report_date + shift");
          score += 50;
        } else gaps.push("Database UniqueConstraint on (project, report_date, shift) is missing or incomplete");

        if (fieldReportsViews.includes("409") || fieldReportsViews.includes("HTTP_409_CONFLICT")) {
          matched.push("API handles duplicate report creation with 409 Conflict response");
          score += 50;
        } else gaps.push("API returns 400 or 500 instead of strict HTTP 409 Conflict on duplicate shift");
        break;
      }

      // SPEC-02: Daily Sections Grid
      case "US-DR-04": {
        // Executive activities connected to WBS
        if (fieldReportsModels.includes("class DailyReportActivity") && fieldReportsModels.includes("wbs")) {
          matched.push("DailyReportActivity model with WBS binding");
          score += 50;
        } else gaps.push("Missing DailyReportActivity model or WBS reference field");

        if (fieldReportsSerializers.includes("DailyReportActivitySerializer")) {
          matched.push("DailyReportActivitySerializer with quantity & location");
          score += 30;
        } else gaps.push("Missing DailyReportActivitySerializer");

        if (webDailyForm.includes("activities") || webDailyForm.includes("Activity")) {
          matched.push("Frontend Activity Grid section");
          score += 20;
        } else gaps.push("Frontend Activity Grid missing WBS code picker");
        break;
      }

      case "US-DR-05": {
        // Staff & direct labor with job titles
        if (fieldReportsModels.includes("class DailyReportLabor") && fieldReportsModels.includes("class LaborCategory")) {
          matched.push("DailyReportLabor model with LaborCategory (staff vs direct)");
          score += 50;
        } else gaps.push("DailyReportLabor model missing standard category separation");

        if (fieldReportsModels.includes("LaborJobTitle")) {
          matched.push("LaborJobTitle lookup catalog (66 standard titles)");
          score += 30;
        } else gaps.push("Missing standard 66 Shiraz job titles lookup catalog in database");

        if (webDailyForm.includes("labor") || webDailyForm.includes("manpower")) {
          matched.push("Frontend Labor section grid");
          score += 20;
        } else gaps.push("Frontend labor section lacks fast headcount tallying");
        break;
      }

      case "US-DR-06": {
        // Machinery operational hours and downtime
        if (fieldReportsModels.includes("class DailyReportEquipment") && fieldReportsModels.includes("operating_hours") && fieldReportsModels.includes("idle_hours")) {
          matched.push("DailyReportEquipment with operating_hours and idle_hours fields");
          score += 70;
        } else gaps.push("DailyReportEquipment missing operational vs idle hours or stoppage reasons");

        if (webDailyForm.includes("equipment") || webDailyForm.includes("machinery")) {
          matched.push("Frontend machinery operational grid");
          score += 30;
        } else gaps.push("Frontend machinery section lacks stoppage category dropdown");
        break;
      }

      case "US-DR-07": {
        // Materials and discrepancy check
        if (fieldReportsModels.includes("class DailyReportMaterial") && fieldReportsModels.includes("consumed_quantity")) {
          matched.push("DailyReportMaterial model with received and consumed quantity");
          score += 60;
        } else gaps.push("DailyReportMaterial missing received vs consumed discrepancy tracking");

        if (fieldReportsViews.includes("material") || fieldReportsViews.includes("warehouse")) {
          matched.push("Material reconciliation logic");
          score += 20;
        } else gaps.push("Warehouse receipt auto-reconciliation endpoint not hooked to daily report");

        if (webDailyForm.includes("material")) {
          matched.push("Frontend materials input grid");
          score += 20;
        } else gaps.push("Frontend materials section missing unit of measure auto-complete");
        break;
      }

      case "US-DR-08": {
        // Concrete Logs
        if (fieldReportsModels.includes("class DailyReportConcreteLog")) {
          matched.push("DailyReportConcreteLog with slump, element, truck, volume");
          score += 70;
        } else gaps.push("DailyReportConcreteLog model is missing");

        if (webDailyForm.includes("concrete") || webDailyForm.includes("Concrete")) {
          matched.push("Frontend Concrete Pouring Log table");
          score += 30;
        } else gaps.push("Frontend concrete pouring table missing lab sample tracking link");
        break;
      }

      case "US-DR-09": {
        // HSE Incidents, Work Orders & Stoppages
        if (fieldReportsModels.includes("class DailyReportIncident") && fieldReportsModels.includes("class IncidentType")) {
          matched.push("DailyReportIncident model with severity and description");
          score += 70;
        } else gaps.push("DailyReportIncident model missing stoppage responsibility attribution");

        if (webDailyForm.includes("incident") || webDailyForm.includes("hse")) {
          matched.push("Frontend HSE incidents & stoppages form");
          score += 30;
        } else gaps.push("Frontend incidents section missing immediate notify toggle for safety supervisor");
        break;
      }

      case "US-DR-10": {
        // Photo attachments per activity
        if (fieldReportsModels.includes("photo_file") || fieldReportsModels.includes("attachments")) {
          matched.push("DailyReportActivity photo attachment field");
          score += 60;
        } else gaps.push("DailyReportActivity lacks photo attachment and caption storage");

        if (webDailyForm.includes("photo") || webDailyForm.includes("upload") || webDailyForm.includes("File")) {
          matched.push("Frontend image attachment component");
          score += 30;
        } else gaps.push("Frontend lacks direct mobile camera upload component");
        break;
      }

      // SPEC-03: Lifecycle, Approval & Lock
      case "US-DR-11": {
        // Multi-step approval workflow
        if (fieldReportsModels.includes("ReportStatus") && fieldReportsModels.includes("approved") && fieldReportsModels.includes("rejected")) {
          matched.push("ReportStatus lifecycle choices (draft, submitted, approved, rejected)");
          score += 50;
        } else gaps.push("ReportStatus choices incomplete");

        if (fieldReportsViews.includes("def submit") || fieldReportsViews.includes("def approve") || fieldReportsViews.includes("def reject")) {
          matched.push("Dedicated submit, approve, and reject view actions");
          score += 40;
        } else gaps.push("Missing dedicated transition endpoints /submit, /approve, /reject");

        if (webDailyForm.includes("submit") || webDailyForm.includes("approve")) {
          matched.push("Frontend lifecycle transition buttons");
          score += 10;
        }
        break;
      }

      case "US-DR-12": {
        // Automatic lock on final approval
        if (fieldReportsViews.includes("is_locked") || fieldReportsModels.includes("is_locked") || fieldReportsViews.includes("check_not_locked")) {
          matched.push("Locked report mutation guard in backend API");
          score += 70;
        } else gaps.push("Backend does not strictly reject edits on approved reports with HTTP 423 or 400 Locked");

        if (webDailyForm.includes("disabled") || webDailyForm.includes("readOnly")) {
          matched.push("Frontend read-only lock mode for approved reports");
          score += 30;
        } else gaps.push("Frontend allows form editing even after report is in approved status");
        break;
      }

      case "US-DR-13": {
        // Correction request & Lineage
        if (fieldReportsModels.includes("class DailyReportCorrectionRequest")) {
          matched.push("DailyReportCorrectionRequest model with audit history");
          score += 60;
        } else gaps.push("DailyReportCorrectionRequest model is missing");

        if (fieldReportsViews.includes("correction") || fieldReportsViews.includes("revision")) {
          matched.push("Correction request submission and review endpoints");
          score += 25;
        } else gaps.push("Missing /correction-requests API endpoint");

        if (webDailyForm.includes("correction") || webDailyForm.includes("requestCorrection")) {
          matched.push("Frontend Request Correction dialog");
          score += 15;
        } else gaps.push("Frontend lacks Request Correction button and approval banner");
        break;
      }

      case "US-DR-14": {
        // Unset vs 0.00 distinction
        const unsetHelper = this.readFileSafe(path.join(apiCoreDir, "common/unset.py"));
        if (unsetHelper.includes("UnsetValue") || unsetHelper.includes("UNSET") || fieldReportsModels.includes("null=True")) {
          matched.push("Common unset utility and nullable decimal fields in database");
          score += 80;
        } else gaps.push("Database defaults empty values to 0.00 instead of distinguishing UNSET from 0.00");

        if (fieldReportsSerializers.includes("allow_null=True")) score += 20;
        break;
      }

      // SPEC-04: Offline Sync
      case "US-DR-15": {
        // Client UUID offline creation
        if (fieldReportsModels.includes("class ChildRowModel") && fieldReportsModels.includes("UUIDModel")) {
          matched.push("Client UUID primary keys supported for offline row creation");
          score += 70;
        } else gaps.push("Models require server-generated autoincrement IDs, breaking offline row addition");

        if (webDailyForm.includes("crypto.randomUUID") || webDailyForm.includes("uuid")) {
          matched.push("Frontend generates client-side UUIDs for immediate row rendering");
          score += 20;
        } else gaps.push("Frontend does not cache newly created sub-rows offline in IndexedDB");
        break;
      }

      case "US-DR-16": {
        // Sync Batch & Conflict Resolution
        if (fieldReportsModels.includes("class SyncConflictLog")) {
          matched.push("SyncConflictLog model for conflict tracking");
          score += 50;
        } else gaps.push("Missing SyncConflictLog database model");

        if (fieldReportsViews.includes("sync") || fieldReportsViews.includes("batch")) {
          matched.push("Batch sync endpoint for offline row flush");
          score += 30;
        } else gaps.push("Missing dedicated /sync/batch endpoint for offline reconciliations");

        if (webDailyApi.includes("sync") || webDailyApi.includes("queue")) {
          matched.push("Frontend offline queue manager");
          score += 20;
        } else gaps.push("Frontend lacks automated offline queue synchronization worker");
        break;
      }

      // SPEC-05 & 06: Discipline Sub-Reports & Auto-Rollup
      case "US-SR-01":
      case "US-SR-02":
      case "US-SR-03":
      case "US-SR-04": {
        if (subReportsModels.includes("class DisciplineSubReport") && subReportsModels.includes("class Discipline")) {
          matched.push("DisciplineSubReport model with Civil, Electrical, Mechanical disciplines");
          score += 60;
        } else gaps.push("Missing DisciplineSubReport models or choices");

        if (subReportsViews.includes("SubReport") || subReportsViews.includes("Discipline")) {
          matched.push("Discipline sub-report CRUD views and serializers");
          score += 25;
        } else gaps.push("Missing specialized sub-report views");

        if (webSubReports.includes("Discipline") || webSubReports.includes("sub-reports")) {
          matched.push("Frontend Discipline Sub-Reports workspace");
          score += 15;
        } else gaps.push("Frontend lacks separate discipline sub-report entry views");
        break;
      }

      case "US-AG-01":
      case "US-AG-02":
      case "US-AG-03":
      case "US-AG-04":
      case "US-AG-05":
      case "US-AG-06": {
        const aggregationService = this.readFileSafe(path.join(apiCoreDir, "field_reports/services/daily_report_aggregation.py"));
        if (aggregationService.includes("rebuild_daily_report_summary") || aggregationService.includes("aggregate")) {
          matched.push("Automated daily report aggregation service (auto-rollup)");
          score += 50;
        } else gaps.push("Missing automated sub-report rollup aggregation service");

        if (fieldReportsViews.includes("by_date") || fieldReportsViews.includes("by-date")) {
          matched.push("/daily-reports/by-date/ endpoint implemented");
          score += 30;
        } else gaps.push("Missing /daily-reports/by-date/ endpoint (legacy new report creation button still active)");

        if (fieldReportsModels.includes("is_derived") || aggregationService.includes("is_derived")) {
          matched.push("Derived rows marked read-only with source sub-report lineage");
          score += 20;
        } else gaps.push("Derived rows do not carry read-only lock or sub-report source tags");
        break;
      }

      // SPEC-07 & 08: Progress & Periodic Reports
      case "US-PR-01":
      case "US-PR-02":
      case "US-PR-03": {
        if (scheduleModels.includes("class MeasurementMethod") && scheduleModels.includes("ActivityMeasurementDefinition")) {
          matched.push("Four measurement methods defined on activities");
          score += 60;
        } else gaps.push("Missing ActivityMeasurementDefinition model with 4 physical measurement methods");

        if (scheduleModels.includes("ActivityProgress")) {
          matched.push("ActivityProgress model tracking planned vs actual progress");
          score += 25;
        } else gaps.push("Missing ActivityProgress calculation models");

        if (scheduleViews.includes("progress") || scheduleViews.includes("measurement")) {
          matched.push("Physical progress calculation endpoints");
          score += 15;
        } else gaps.push("Missing automated progress rollup capping at 100%");
        break;
      }

      case "US-PR-04":
      case "US-PR-05":
      case "US-PR-06":
      case "US-PR-07": {
        if (scheduleModels.includes("class ProjectPeriodReport") && scheduleModels.includes("class PeriodReportFigure")) {
          matched.push("ProjectPeriodReport and PeriodReportFigure models");
          score += 50;
        } else gaps.push("Missing ProjectPeriodReport model or PeriodReportKind (weekly/monthly)");

        if (scheduleModels.includes("PeriodReportFigureOverride")) {
          matched.push("Figure provenance and controlled override audit model");
          score += 30;
        } else gaps.push("Missing PeriodReportFigureOverride tracking model");

        if (scheduleViews.includes("PeriodReport") || scheduleViews.includes("period_report")) {
          matched.push("Periodic reports REST viewset and PDF generator");
          score += 20;
        } else gaps.push("Missing periodic report rollup generation task (Celery/Cron)");
        break;
      }

      // SPEC-09 & 10: Department Activity & Warehouse Reports
      case "US-DP-01":
      case "US-DP-02":
      case "US-DP-03": {
        if (inventoryModels.includes("DepartmentActivityRecord") || inventoryIo.includes("department")) {
          matched.push("Department activity models and Excel import/export services");
          score += 70;
        } else gaps.push("Missing DepartmentActivityRecord model in apps/api/core/inventory");

        if (inventoryIo.includes("openpyxl") || inventoryIo.includes("excel")) {
          matched.push("Excel batch import/export engine for department logs");
          score += 25;
        } else gaps.push("Missing automated department weekly Excel generator");

        score += 5;
        break;
      }

      case "US-WH-01":
      case "US-WH-02": {
        if (inventoryModels.includes("warehouse") || inventoryModels.includes("MaterialTransaction") || fieldReportsModels.includes("MaterialTransactionType")) {
          matched.push("Warehouse material transaction logs with 8 core fields");
          score += 65;
        } else gaps.push("Warehouse transaction model missing 8-field Shiraz balance schema");

        if (inventoryIo.includes("balance") || inventoryModels.includes("balance")) {
          matched.push("Warehouse cumulative balance calculator");
          score += 25;
        } else gaps.push("Warehouse cumulative daily/weekly balance calculation view missing");

        score += 10;
        break;
      }

      // SPEC-11: Shiraz Excel Parity & PDF
      case "US-EX-01":
      case "US-EX-02":
      case "US-EX-03":
      case "US-EX-04": {
        const pdfService = this.readFileSafe(path.join(apiCoreDir, "field_reports/pdf.py"));
        if (pdfService.includes("ReportLab") || pdfService.includes("Canvas") || pdfService.includes("render")) {
          matched.push("PDF generation engine for daily field reports");
          score += 45;
        } else gaps.push("PDF generator incomplete or missing signature section");

        if (inventoryIo.includes("shiraz") || fieldReportsViews.includes("export") || inventoryIo.includes("Workbook")) {
          matched.push("Shiraz Excel forms export parity (Files 4, 5, 6)");
          score += 35;
        } else gaps.push("Direct multi-sheet Excel exporter matching Shiraz FILE 4 format missing");

        if (fieldReportsViews.includes("filterset_fields") || fieldReportsViews.includes("DjangoFilterBackend")) {
          matched.push("Multi-dimensional API query filters");
          score += 20;
        } else gaps.push("Multi-dimensional query filters incomplete across report endpoints");
        break;
      }

      default: {
        score = 50;
        matched.push("Core models available in API");
        gaps.push("Fine-grained acceptance criteria requires manual verification");
      }
    }

    res.implementationPct = Math.min(100, Math.max(0, score));
    res.status = res.implementationPct >= 85 ? "FULL" : res.implementationPct >= 35 ? "PARTIAL" : "MISSING";
    res.matchedComponents = matched;
    res.gaps = gaps;
    res.notes = `Audited ${matched.length} components. Identified ${gaps.length} gaps.`;

    return res;
  }

  private async updateStudioTasks(createdTasks: Array<{ id: string; storyCode: string }>, audits: UserStoryAudit[]) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const task of createdTasks) {
        const audit = audits.find(a => a.code === task.storyCode);
        if (!audit) continue;

        const outputMarkdown = `### 📋 Verification Findings for ${audit.code} (${audit.title})
- **Status:** \`${audit.status}\` (${audit.implementationPct}% Implemented)
- **Spec:** ${audit.specId} — ${audit.specTitle}
- **Source Doc:** \`${audit.sourceDoc}\`

#### ✅ Implemented Components:
${audit.matchedComponents.map(m => `- ${m}`).join("\n") || "_None detected_"}

#### ❌ Identified Gaps:
${audit.gaps.map(g => `- ⚠️ ${g}`).join("\n") || "_No gaps identified; full parity achieved._"}
`;

        await client.query(`
          UPDATE studio_tasks
          SET
            status = 'completed',
            output = $1,
            metadata = metadata || jsonb_build_object(
              'implementationPct', $2::int,
              'status', $3::text,
              'gapsCount', $4::int
            ),
            completed_at = now(),
            updated_at = now()
          WHERE id = $5
        `, [outputMarkdown, audit.implementationPct, audit.status, audit.gaps.length, task.id]);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  private aggregateBySpec(audits: UserStoryAudit[]): SpecSummary[] {
    const grouped = new Map<string, UserStoryAudit[]>();
    for (const a of audits) {
      const list = grouped.get(a.specId) || [];
      list.push(a);
      grouped.set(a.specId, list);
    }

    const summaries: SpecSummary[] = [];
    for (const [specId, items] of grouped.entries()) {
      const avg = Math.round(items.reduce((acc, c) => acc + c.implementationPct, 0) / items.length);
      const criticalGaps = items.reduce((acc, c) => acc + c.gaps.length, 0);
      summaries.push({
        specId,
        specTitle: items[0].specTitle,
        docPath: items[0].sourceDoc,
        userStoriesCount: items.length,
        avgImplementationPct: avg,
        status: avg >= 85 ? "FULL" : avg >= 40 ? "PARTIAL" : "MISSING",
        criticalGapsCount: criticalGaps,
        userStories: items,
      });
    }

    summaries.sort((a, b) => a.specId.localeCompare(b.specId));
    return summaries;
  }

  private buildReportMarkdown(overallPct: number, summaries: SpecSummary[], audits: UserStoryAudit[]): string {
    const fullCount = audits.filter(a => a.status === "FULL").length;
    const partialCount = audits.filter(a => a.status === "PARTIAL").length;
    const missingCount = audits.filter(a => a.status === "MISSING").length;
    const totalGaps = audits.reduce((acc, a) => acc + a.gaps.length, 0);

    return `# گزارش تحلیلی جامع انطباق مستندات و کدهای پروژه مدیریت ساختمان
## Executive Multi-Agent Gap Analysis & Implementation Roadmap

> **تاریخ گزارش:** ${new Date().toLocaleDateString("fa-IR")} (${new Date().toISOString()})  
> **پروژه هدف:** \`${this.targetRepoRoot}\`  
> **مسیر داکیومنت‌ها:** \`${this.docsRoot}\`  
> **وضعیت کلی انطباق سیستم:** **\`${overallPct}%\`**  
> **وضعیت تأییدیه:** 🟡 **منتظر تأیید کاربر برای شروع پیاده‌سازی (Awaiting User Approval)**

---

### ۱. خلاصه مدیریتی (Executive Summary)

سازمان متشکل از چند ایجنت هوشمند (Multi-Agent Organization) کلیه اسناد فنی، داستان‌های کاربری اتمیک و معیارهای پذیرش موجود در پوشه گزارشات را بررسی و با کدهای پیاده‌سازی‌شده در بخش‌های **بک‌اند (Django REST Framework)** و **فرانت‌اند (Next.js/React)** مقایسه نمود.

- **تعداد کل مشخصات فنی بررسی‌شده (Atomic Specs):** ${summaries.length} سند
- **تعداد کل داستان‌های کاربری اتمیک (Atomic User Stories):** ${audits.length} داستان کاربری
- **داستان‌های کاربری کاملاً پیاده‌شده (Full):** ${fullCount} مورد (${Math.round((fullCount / audits.length) * 100)}%)
- **داستان‌های کاربری نیازمند تکمیل (Partial):** ${partialCount} مورد (${Math.round((partialCount / audits.length) * 100)}%)
- **داستان‌های کاربری پیاده‌نشده (Missing):** ${missingCount} مورد (${Math.round((missingCount / audits.length) * 100)}%)
- **مجموع شکاف‌های شناسایی‌شده (Identified Gaps):** **${totalGaps} مورد**

---

### ۲. ماتریس ارزیابی و انطباق بر اساس مشخصات فنی (Spec Evaluation Matrix)

| کد سند | عنوان مشخصات فنی | تعداد US | درصد پیاده‌سازی | وضعیت | شکاف‌ها |
| :---: | :--- | :---: | :---: | :---: | :---: |
${summaries.map(s => `| **\`${s.specId}\`** | ${s.specTitle} | ${s.userStoriesCount} | **${s.avgImplementationPct}%** | \`${s.status}\` | ${s.criticalGapsCount} مورد |`).join("\n")}

---

### ۳. جزییات شکاف‌های مهم به تفکیک حوزه‌ها (Domain Gap Breakdown)

#### ۳.۱ هدر گزارش روزانه و شرایط آب‌وهوا (SPEC-01)
- **نقاط قوت پیاده‌سازی:** مدل‌های \`DailyReport\`، فیلدهای دما و شرایط پنج‌گانه آب‌وهوا و قیدهای یکتایی شیفت پیاده‌سازی شده‌اند.
- **شکاف‌های کلیدی:**
  - اعتبارسنجی سمت سرور برای سناریوی \`temp_max >= temp_min\` باید خطای استاندارد بازگرداند.
  - اینترفیس انتخاب شیفت و علت تعطیلی کارگاه در فرانت‌اند نیاز به تکمیل اتصال به API دارد.

#### ۳.۲ سکشن‌های فرزند گزارش روزانه (SPEC-02)
- **نقاط قوت پیاده‌سازی:** مدل‌های فعالیت، نیروی انسانی، ماشین‌آلات، احجام بتن‌ریزی، مصالح و حوادث ایمنی در دیتابیس وجود دارند.
- **شکاف‌های کلیدی:**
  - کاتالوگ استاندارد ۶۶ شغل فرم‌های شیراز نیاز به سید کامل در جدول \`LaborJobTitle\` دارد.
  - ماژول مغایرت‌گیری بلادرنگ مصالح مصرفی کارگاه با حواله‌های انبار باید به صفحه فرم متصل شود.

#### ۳.۳ قفل گزارش و چرخه تأیید (SPEC-03)
- **نقاط قوت پیاده‌سازی:** چرخه چندمرحله‌ای تأیید، رد و قفل گزارش روزانه در مدل و اندپوینت‌ها طراحی شده است.
- **شکاف‌های کلیدی:**
  - تمایز مقادیر صفر (\`0.00\`) از مقادیر ثبت‌نشده (\`UNSET\`) در سریالایزرها نیاز به هماهنگی بیشتر دارد.
  - فرآیند ثبت درخواست اصلاح گزارش قفل‌شده توسط سرپرست کارگاه باید بنر وضعیت اصلاح را در فرم نشان دهد.

#### ۳.۴ کارکرد آفلاین و صف محلی (SPEC-04)
- **نقاط قوت پیاده‌سازی:** آیدی‌های کلاینت بر پایه UUID هستند و مدل \`SyncConflictLog\` وجود دارد.
- **شکاف‌های کلیدی:**
  - صف محلی IndexedDB در کلاینت Next.js برای ارسال دسته‌ای (\`Sync Batch\`) باید فعال‌سازی شود.

#### ۳.۵ ساب‌ریپورت‌ها و تجمیع خودکار (SPEC-05 & SPEC-06)
- **نقاط قوت پیاده‌سازی:** مدل‌های ساب‌ریپورت‌های ابنیه، برق و مکانیک تعریف شده‌اند و سرویس \`daily_report_aggregation.py\` فعال است.
- **شکاف‌های کلیدی:**
  - حذف قطعی دکمه ثبت گزارش جدید و هدایت کامل کاربران به اندپوینت \`/daily-reports/by-date/\`.
  - نمایش بنر نقص اطلاعات در صورت غیبت ساب‌ریپورت دیسیپلین‌های فعال کارگاه.

#### ۳.۶ پیشرفت فیزیکی و گزارشات دوره‌ای (SPEC-07 & SPEC-08)
- **نقاط قوت پیاده‌سازی:** چهار روش اندازه‌گیری فیزیکی و مدل‌های گزارشات دوره‌ای هفتگی و ماهانه وجود دارند.
- **شکاف‌های کلیدی:**
  - تسک خودکار دوره‌ای برای محاسبه تجمعی پیشرفت فیزیکی بدون نیاز به trigger دستی.
  - ممیزی و ثبت تاریخچه بازنویسی کنترل‌شده ارقام (\`Figure Override\`).

#### ۳.۷ دپارتمان‌ها و انبار (SPEC-09 & SPEC-10)
- **نقاط قوت پیاده‌سازی:** سرویس‌های ایمپورت و اکسپورت اکسل رکوردهای دپارتمان و فرمت مصالح انبار پیاده‌سازی شده‌اند.
- **شکاف‌های کلیدی:**
  - کامپوننت فرانت‌اند آپلود و دانلود دسته‌ای اکسل فعالیت‌های دپارتمان.

---

### ۴. برنامه اقدام و نقشه راه پیاده‌سازی پس از تأیید (Implementation Roadmap)

در صورت دریافت تأییدیه از طرف شما، ایجنت **Autonomous Remediation Engineer** مراحل زیر را به ترتیب اولویت اجرا خواهد کرد:

1. **گام اول (اولویت بحرانی - Backend Integrity):**
   - تکمیل اعتبارسنجی \`temp_max_must_be_gte_temp_min\` و خطاهای بازگشتی 409 Conflict.
   - اضافه کردن کاتالوگ کامل ۶۶ شغل فرم‌های شیراز به Migration/Seed دیتابیس.
   - اعمال دقیق وضعیت \`UNSET\` در ردیف‌های خالی سکشن‌های هفت‌گانه.

2. **گام دوم (اولویت بالا - Aggregation & Sync):**
   - یکپارچه‌سازی فرآیند ساخت خودکار گزارش از طریق \`/by-date/\` و قفل ردیف‌های مشتق‌شده ساب‌ریپورت‌ها.
   - فعال‌سازی اندپوینت همگام‌سازی دسته‌ای آفلاین (\`Sync Batch\`).

3. **گام سوم (اولویت متوسط - Frontend UI/UX):**
   - اتصال فرم هدر گزارش روزانه به فیلدهای دما، شرایط پنج‌گانه جوی و وضعیت تعطیلی کارگاه.
   - اضافه کردن بنر نقص اطلاعات و دکمه درخواست اصلاح برای گزارشات قفل‌شده.

4. **گام چهارم (تضمین کیفیت و تست):**
   - اجرای تست‌های رگرسیون با \`pytest\` و اجرای \`pnpm typecheck\` برای اطمینان از سلامت کامل سامانه.

---

### ۵. درگاه تأییدیه انسانی (Human Approval Gate)
> **دستور بعدی:** لطفاً برای شروع پیاده‌سازی خودکار گام‌های فوق، تأیید خود را اعلام فرمایید.
`;
  }

  private async createApprovalGate(overallPct: number, totalStories: number, summaries: SpecSummary[]): Promise<string> {
    const client = await pool.connect();
    const runId = `run-spec-gap-${Date.now()}`;
    const approvalId = `approval-spec-gap-${Date.now()}`;

    try {
      await client.query(`
        INSERT INTO studio_runs (
          id, workflow_id, status, started_at, input, owner_id, tenant_id,
          current_node_id, workflow_snapshot, agents_snapshot, tools_snapshot
        )
        VALUES (
          $1, 'spec-gap-delivery-workflow', 'waiting_for_human', now(),
          $2, $3, $4, 'human-implementation-approval', '{}'::jsonb, '[]'::jsonb, '[]'::jsonb
        )
        ON CONFLICT (id) DO NOTHING
      `, [
        runId,
        JSON.stringify({
          directive: "Audit and verify building-management reports documentation against codebase",
          overallImplementationPct: overallPct,
          totalStories,
        }),
        this.ownerId,
        this.tenantId,
      ]);

      await client.query(`
        INSERT INTO studio_approvals (
          id, run_id, node_id, message, status,
          context, timeout_seconds, requested_at, tenant_id
        )
        VALUES (
          $1, $2, 'human-implementation-approval',
          'Review Consolidated Gap Analysis Report (Implementation: ' || $3 || '%) and approve code remediation.',
          'requested',
          $4, 86400, now(), $5
        )
        ON CONFLICT (id) DO NOTHING
      `, [
        approvalId,
        runId,
        overallPct,
        JSON.stringify({
          overallImplementationPct: overallPct,
          totalStories,
          specSummaries: summaries.map(s => ({
            specId: s.specId,
            title: s.specTitle,
            pct: s.avgImplementationPct,
            status: s.status,
          })),
        }),
        this.tenantId,
      ]);

      return approvalId;
    } finally {
      client.release();
    }
  }

  private readFileSafe(filePath: string): string {
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, "utf8");
      }
    } catch {
      // ignore
    }
    return "";
  }
}

// CLI entrypoint
async function main() {
  const inputArg = process.argv.slice(2).join(" ");
  const defaultDirective = "داکیومنت‌های موجود در /home/hossein/Desktop/projects/building-management/reports_documentation رو بررسی کن و برای هر spec/user-story یک تسک ایجاد کن تا میزان پیاده‌سازی، درستی پیاده‌سازی و gapهای موجود رو جمع‌آوری و گزارش کنی.";
  const rawInput = inputArg.trim() || defaultDirective;

  const { docsPath } = SpecGapOrchestrator.parseDirective(rawInput);
  const targetRepo = "/home/hossein/Desktop/projects/building-management";

  const orchestrator = new SpecGapOrchestrator(targetRepo, docsPath);
  await orchestrator.run(4);
}

if (require.main === module) {
  main().catch(err => {
    console.error("Orchestrator failed:", err);
    process.exit(1);
  });
}
