import * as fs from "node:fs";
import * as path from "node:path";
import { validateAgainstSchema } from "@multi-agent/types";
import { StudioTaskToolExecutor } from "../src/tools/studioTaskToolExecutor";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import type { StudioTask } from "../src/studio/contracts";

let YAML: { parse: (text: string) => any };
try {
  YAML = require("yaml");
} catch {
  YAML = require("../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml");
}

describe("Studio Task Tool OpenAPI Contract Tests (T014)", () => {
  const contractPath = path.resolve(
    __dirname,
    "../specs/009-dual-mode-orchestration/contracts/studio-task-tool.openapi.yaml",
  );
  const openapiContent = fs.readFileSync(contractPath, "utf-8");
  const openapiDoc = YAML.parse(openapiContent);
  const schemas = openapiDoc.components.schemas;

  function makeStandaloneSchema(targetSchema: Record<string, unknown>): Record<string, unknown> {
    const jsonStr = JSON.stringify(targetSchema).replace(/#\/components\/schemas\//g, "#/$defs/");
    const parsed = JSON.parse(jsonStr);
    return {
      ...parsed,
      $defs: JSON.parse(JSON.stringify(schemas).replace(/#\/components\/schemas\//g, "#/$defs/")),
    };
  }

  const queryTasksSchema = makeStandaloneSchema(schemas.QueryTasksAction);
  const updateTaskStatusSchema = makeStandaloneSchema(schemas.UpdateTaskStatusAction);
  const assignTaskSchema = makeStandaloneSchema(schemas.AssignTaskAction);
  const addTaskCommentSchema = makeStandaloneSchema(schemas.AddTaskCommentAction);
  const toolSuccessResponseSchema = makeStandaloneSchema(schemas.ToolSuccessResponse);
  const toolErrorResponseSchema = makeStandaloneSchema(schemas.ToolErrorResponse);

  describe("OpenAPI Document Structural Integrity", () => {
    test("OpenAPI spec has valid version, metadata, and execution endpoint", () => {
      expect(openapiDoc.openapi).toBe("3.1.0");
      expect(openapiDoc.info.title).toBe("Studio Task Management Tool API");
      expect(openapiDoc.paths["/tools/studio-task/execute"]).toBeDefined();
      expect(openapiDoc.paths["/tools/studio-task/execute"].post).toBeDefined();
    });

    test("All required schemas exist in components.schemas", () => {
      const requiredSchemas = [
        "TaskStatus",
        "TaskPriority",
        "QueryTasksAction",
        "UpdateTaskStatusAction",
        "AssignTaskAction",
        "AddTaskCommentAction",
        "ToolSuccessResponse",
        "ToolErrorResponse",
      ];
      for (const name of requiredSchemas) {
        expect(schemas[name]).toBeDefined();
      }
    });
  });

  describe("QueryTasksAction Schema Validation", () => {
    test("validates full and minimal query_tasks payload", () => {
      const fullPayload = {
        action: "query_tasks",
        params: {
          status: "queued",
          projectId: "proj-1",
          workspaceId: "ws-1",
          assignedAgent: "agent-lead",
          limit: 25,
          offset: 10,
        },
      };
      const res = validateAgainstSchema(queryTasksSchema, fullPayload);
      expect(res.valid).toBe(true);

      const minimalPayload = {
        action: "query_tasks",
        params: {},
      };
      const resMin = validateAgainstSchema(queryTasksSchema, minimalPayload);
      expect(resMin.valid).toBe(true);
    });

    test("accepts all TaskStatus enum values in query_tasks params", () => {
      const validStatuses = ["queued", "in_progress", "in_review", "done", "failed", "paused"];
      for (const status of validStatuses) {
        const payload = {
          action: "query_tasks",
          params: { status },
        };
        const res = validateAgainstSchema(queryTasksSchema, payload);
        expect(res.valid).toBe(true);
      }
    });

    test("rejects invalid status, out-of-bounds limit, and negative offset", () => {
      const invalidPayload = {
        action: "query_tasks",
        params: {
          status: "non_existent_status",
          limit: 200, // max is 100
          offset: -5, // min is 0
        },
      };
      const res = validateAgainstSchema(queryTasksSchema, invalidPayload);
      expect(res.valid).toBe(false);
      expect(res.issues.some((i) => i.path === "$.params.status")).toBe(true);
      expect(res.issues.some((i) => i.path === "$.params.limit")).toBe(true);
    });
  });

  describe("UpdateTaskStatusAction Schema Validation", () => {
    test("validates valid update_task_status payload with all lifecycle statuses", () => {
      const validStatuses = ["queued", "in_progress", "in_review", "done", "failed", "paused"];
      for (const newStatus of validStatuses) {
        const payload = {
          action: "update_task_status",
          params: {
            taskId: "task-001",
            newStatus,
            reason: `Moving task to ${newStatus}`,
          },
        };
        const res = validateAgainstSchema(updateTaskStatusSchema, payload);
        expect(res.valid).toBe(true);
      }
    });

    test("rejects missing taskId, missing newStatus, or invalid status", () => {
      const missingTaskId = {
        action: "update_task_status",
        params: {
          newStatus: "in_progress",
        },
      };
      expect(validateAgainstSchema(updateTaskStatusSchema, missingTaskId).valid).toBe(false);

      const missingNewStatus = {
        action: "update_task_status",
        params: {
          taskId: "task-001",
        },
      };
      expect(validateAgainstSchema(updateTaskStatusSchema, missingNewStatus).valid).toBe(false);

      const invalidStatus = {
        action: "update_task_status",
        params: {
          taskId: "task-001",
          newStatus: "unknown_status",
        },
      };
      expect(validateAgainstSchema(updateTaskStatusSchema, invalidStatus).valid).toBe(false);
    });

    test("rejects reason exceeding 500 characters", () => {
      const longReason = {
        action: "update_task_status",
        params: {
          taskId: "task-001",
          newStatus: "in_progress",
          reason: "a".repeat(501),
        },
      };
      const res = validateAgainstSchema(updateTaskStatusSchema, longReason);
      expect(res.valid).toBe(false);
      expect(res.issues.some((i) => i.path === "$.params.reason")).toBe(true);
    });
  });

  describe("AssignTaskAction Schema Validation", () => {
    test("validates valid assign_task payload with single and multiple agents", () => {
      const singlePayload = {
        action: "assign_task",
        params: {
          taskId: "task-001",
          assignedAgent: "agent-auditor",
        },
      };
      expect(validateAgainstSchema(assignTaskSchema, singlePayload).valid).toBe(true);

      const multiPayload = {
        action: "assign_task",
        params: {
          taskId: "task-001",
          assignedAgent: "agent-auditor",
          assignedAgents: ["agent-auditor", "agent-developer"],
        },
      };
      expect(validateAgainstSchema(assignTaskSchema, multiPayload).valid).toBe(true);
    });

    test("rejects missing taskId or missing assignedAgent", () => {
      const missingTaskId = {
        action: "assign_task",
        params: { assignedAgent: "agent-auditor" },
      };
      expect(validateAgainstSchema(assignTaskSchema, missingTaskId).valid).toBe(false);

      const missingAgent = {
        action: "assign_task",
        params: { taskId: "task-001" },
      };
      expect(validateAgainstSchema(assignTaskSchema, missingAgent).valid).toBe(false);
    });
  });

  describe("AddTaskCommentAction Schema Validation", () => {
    test("validates valid comment payload with structured audit metadata and roles", () => {
      const roles: Array<"agent" | "system" | "user"> = ["agent", "system", "user"];
      for (const authorRole of roles) {
        const payload = {
          action: "add_task_comment",
          params: {
            taskId: "task-001",
            content: "Audit report: 11 of 14 checks passed. Completeness score: 78.5%.",
            authorRole,
            authorAgentId: "agent-auditor-1",
            metadata: {
              completenessScore: 78.5,
              gapsCount: 3,
              iteration: 1,
              reportRef: "SPEC-01-WEATHER",
            },
          },
        };
        const res = validateAgainstSchema(addTaskCommentSchema, payload);
        expect(res.valid).toBe(true);
      }
    });

    test("rejects missing taskId, missing content, and invalid authorRole", () => {
      const missingContent = {
        action: "add_task_comment",
        params: { taskId: "task-001" },
      };
      expect(validateAgainstSchema(addTaskCommentSchema, missingContent).valid).toBe(false);

      const invalidRole = {
        action: "add_task_comment",
        params: {
          taskId: "task-001",
          content: "Hello",
          authorRole: "invalid_role",
        },
      };
      expect(validateAgainstSchema(addTaskCommentSchema, invalidRole).valid).toBe(false);
    });

    test("rejects comment content exceeding 4000 characters", () => {
      const longContent = {
        action: "add_task_comment",
        params: {
          taskId: "task-001",
          content: "x".repeat(4001),
        },
      };
      const res = validateAgainstSchema(addTaskCommentSchema, longContent);
      expect(res.valid).toBe(false);
      expect(res.issues.some((i) => i.path === "$.params.content")).toBe(true);
    });
  });

  describe("Response Schemas & Live Tool Output Compliance", () => {
    test("ToolSuccessResponse schema validates successful executor output", async () => {
      const store = new InMemoryStudioStore();
      const executor = new StudioTaskToolExecutor(store);

      await store.saveTask({
        id: "task-contract-1",
        title: "Test Contract Task",
        description: "Task for testing schema compliance",
        priority: "high",
        status: "queued",
        assignedAgent: null,
        projectId: "proj-building-gap",
        workspaceId: "ws-sandbox",
        dependencies: [],
        output: null,
        retryCount: 0,
        paused: false,
        tenantId: "tenant-contract",
        createdAt: new Date().toISOString(),
      });

      const output = await executor.execute({
        tool: {
          id: "tool-studio-task",
          name: "studio_task_tool",
          category: "function",
          description: "Studio Task Tool",
          inputSchema: {},
          outputSchema: {},
          configuration: {},
          enabled: true,
          impact: "write",
          metadata: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        input: {
          action: "query_tasks",
          params: { status: "queued" },
        },
        credentialPrincipal: {
          tenantId: "tenant-contract",
          principalId: "lead-orchestrator",
        },
      });

      expect(output.success).toBe(true);
      const res = validateAgainstSchema(toolSuccessResponseSchema, output);
      expect(res.valid).toBe(true);
    });

    test("ToolErrorResponse schema validates error executor output", async () => {
      const store = new InMemoryStudioStore();
      const executor = new StudioTaskToolExecutor(store);

      // Attempt foreign tenant access to trigger TENANT_ISOLATION_VIOLATION
      await store.saveTask({
        id: "task-tenant-alien",
        title: "Alien Task",
        description: "belongs to foreign tenant",
        priority: "medium",
        status: "queued",
        assignedAgent: null,
        projectId: "proj-alien",
        dependencies: [],
        output: null,
        retryCount: 0,
        paused: false,
        tenantId: "tenant-alien",
        createdAt: new Date().toISOString(),
      });

      const errorOutput = await executor.execute({
        tool: {
          id: "tool-studio-task",
          name: "studio_task_tool",
          category: "function",
          description: "Studio Task Tool",
          inputSchema: {},
          outputSchema: {},
          configuration: {},
          enabled: true,
          impact: "write",
          metadata: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        input: {
          action: "update_task_status",
          params: {
            taskId: "task-tenant-alien",
            newStatus: "in_progress",
          },
        },
        credentialPrincipal: {
          tenantId: "tenant-local",
          principalId: "lead-orchestrator",
        },
      });

      expect(errorOutput.success).toBe(false);
      expect((errorOutput as any).error.code).toBe("TENANT_ISOLATION_VIOLATION");

      const res = validateAgainstSchema(toolErrorResponseSchema, errorOutput);
      expect(res.valid).toBe(true);
    });

    test("ToolErrorResponse validates all specified error codes", () => {
      const validCodes = [
        "TASK_NOT_FOUND",
        "INVALID_STATUS_TRANSITION",
        "TENANT_ISOLATION_VIOLATION",
        "INVALID_INPUT",
        "DEPENDENCY_BLOCKED",
      ];
      for (const code of validCodes) {
        const errorResponse = {
          success: false,
          action: "update_task_status",
          error: {
            code,
            message: `Error with code ${code}`,
          },
          timestamp: new Date().toISOString(),
        };
        const res = validateAgainstSchema(toolErrorResponseSchema, errorResponse);
        expect(res.valid).toBe(true);
      }
    });

    test("ToolErrorResponse rejects unlisted error codes", () => {
      const invalidErrorResponse = {
        success: false,
        action: "query_tasks",
        error: {
          code: "UNKNOWN_CUSTOM_ERROR",
          message: "Not permitted code",
        },
        timestamp: new Date().toISOString(),
      };
      const res = validateAgainstSchema(toolErrorResponseSchema, invalidErrorResponse);
      expect(res.valid).toBe(false);
    });
  });
});
