import { nowIso, uid, type TaskComment } from "@multi-agent/types";
import type { Hono } from "hono";
import type { StudioStore } from "../../../../../src/studio/contracts";
import type { PrincipalVariables } from "../shared/http";
import { ApiError } from "../shared/http";

export function extractMentions(text: string): string[] {
  const matches = text.matchAll(/(?:^|\s)@([a-zA-Z0-9_-]+)/g);
  const mentions = new Set<string>();
  for (const match of matches) {
    if (match[1]) mentions.add(match[1].toLowerCase());
  }
  return [...mentions];
}

/**
 * Register task comments API routes on the Studio app.
 */
export function registerTaskCommentRoutes(
  app: Hono<{ Variables: PrincipalVariables }>,
  store: StudioStore,
) {
  // List comments for a task
  app.get("/tasks/:id/comments", async (c) => {
    const principal = c.get("principal");
    const taskId = c.req.param("id");
    const task = await store.getTask(taskId, principal);
    if (!task) throw new ApiError(404, `Task "${taskId}" not found`);
    const comments = await store.listComments(taskId, principal);
    return c.json(comments);
  });

  // Post a new comment on a task
  app.post("/tasks/:id/comments", async (c) => {
    const principal = c.get("principal");
    const taskId = c.req.param("id");
    const task = await store.getTask(taskId, principal);
    if (!task) throw new ApiError(404, `Task "${taskId}" not found`);

    const body = await c.req.json().catch(() => ({}));
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) throw new ApiError(400, "Comment content is required");
    if (content.length > 10_000) throw new ApiError(400, "Comment exceeds 10,000 character limit");

    const internalSecret = process.env.INTERNAL_PRINCIPAL_SECRET;
    const isInternalWorker =
      (Boolean(internalSecret) && c.req.header("x-internal-worker-secret") === internalSecret) ||
      principal.userId.startsWith("internal:agent:");

    let authorType: "user" | "agent" | "system" = "user";
    let authorId = principal.userId;

    if (isInternalWorker && body.authorType === "agent" && typeof body.authorId === "string" && body.authorId.trim()) {
      authorType = "agent";
      authorId = body.authorId.trim();
    } else if (isInternalWorker && body.authorType === "system") {
      authorType = "system";
      authorId = typeof body.authorId === "string" && body.authorId.trim() ? body.authorId.trim() : "system";
    }

    const rawMentions = extractMentions(content);
    const workspaceAgents = await store.listAgents(principal);
    const activeAgents = workspaceAgents.filter((a) => a.enabled !== false);

    // Strictly validate mentions against active authorized workspace agents
    const validatedMentions: string[] = [];
    for (const mention of rawMentions) {
      const matched = activeAgents.find(
        (a) => a.id.toLowerCase() === mention.toLowerCase() || a.name.toLowerCase() === mention.toLowerCase(),
      );
      if (matched && !validatedMentions.includes(matched.id)) {
        validatedMentions.push(matched.id);
      }
    }

    const comment: TaskComment = {
      id: uid("comment"),
      tenantId: principal.tenantId,
      taskId,
      authorId,
      authorType,
      content,
      mentions: validatedMentions,
      metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    // Determine target agents to wake
    let targetAgents: typeof activeAgents = [];
    if (validatedMentions.length > 0) {
      targetAgents = activeAgents.filter((a) => validatedMentions.includes(a.id));
    } else {
      const assigned = task.assignedAgents ?? (task.assignedAgent ? [task.assignedAgent] : []);
      targetAgents = activeAgents.filter((a) =>
        assigned.some((id) => id.toLowerCase() === a.id.toLowerCase() || id.toLowerCase() === a.name.toLowerCase()),
      );
    }

    // Self-comment loop suppression: if author is an agent, never wake itself in a loop!
    const filteredAgents = targetAgents.filter((agent) => {
      if (authorType === "agent") {
        if (authorId.toLowerCase() === agent.id.toLowerCase() || authorId.toLowerCase() === agent.name.toLowerCase()) {
          return false; // Suppressed!
        }
      }
      return true;
    });

    // Atomically persist comment and all associated trigger events in the exact same transaction
    const saved = await store.transaction(async (tx) => {
      const savedComment = await tx.saveComment(comment, principal);
      for (const agent of filteredAgents) {
        await tx.enqueueTriggerEvent({
          tenantId: principal.tenantId,
          eventType: validatedMentions.length > 0 ? "task_mention" : "task_comment",
          targetType: "task",
          targetId: taskId,
          idempotencyKey: `comment:${savedComment.id}:${agent.id}`,
          maxRetries: 3,
          payload: {
            commentId: savedComment.id,
            authorId,
            authorType,
            targetAgentId: agent.id,
            content: savedComment.content,
            taskId,
          },
        });
      }
      return savedComment;
    });

    return c.json(saved, 201);
  });

  // Delete a comment
  app.delete("/tasks/:id/comments/:commentId", async (c) => {
    const principal = c.get("principal");
    const taskId = c.req.param("id");
    const commentId = c.req.param("commentId");
    const task = await store.getTask(taskId, principal);
    if (!task) throw new ApiError(404, `Task "${taskId}" not found`);
    await store.deleteComment(commentId, principal);
    return c.json({ ok: true });
  });
}
