import { NextResponse } from "next/server";
import { getAuthenticatedPrincipal } from "@/auth";
import {
  TaskActionError,
  cancelTask,
  createTask,
  deleteTask,
  getBoardData,
  moveTask,
  retryTask,
  setTaskPaused,
  startTask,
  updateTask,
  UpdateTaskPatch,
} from "@/lib/taskBoard";
import { TaskPriority, TaskStatus } from "@/lib/taskStatus";

export const dynamic = "force-dynamic";

export async function GET() {
  const principal = await getAuthenticatedPrincipal();
  if (!principal) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const board = await getBoardData(principal);
  return NextResponse.json(board);
}

interface TaskActionBody {
  action?: string;
  taskId?: string;
  // create / update fields
  title?: string;
  description?: string;
  priority?: TaskPriority;
  assignedAgent?: string | null;
  assignedAgents?: string[];
  workflowId?: string | null;
  parentTaskId?: string | null;
  dependencies?: string[];
  status?: TaskStatus;
  // move
  toStatus?: TaskStatus;
  // pause / resume
  paused?: boolean;
  // update patch
  patch?: UpdateTaskPatch;
}

export async function POST(request: Request) {
  const principal = await getAuthenticatedPrincipal();
  if (!principal) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: TaskActionBody;
  try {
    body = (await request.json()) as TaskActionBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action, taskId } = body;

  try {
    switch (action) {
      case "create": {
        const task = await createTask({
          title: body.title ?? "",
          description: body.description,
          priority: body.priority,
          assignedAgent: body.assignedAgent ?? null,
          assignedAgents: body.assignedAgents,
          workflowId: body.workflowId ?? null,
          parentTaskId: body.parentTaskId ?? null,
          dependencies: body.dependencies ?? [],
          status: body.status,
        }, principal);
        return NextResponse.json({ success: true, task });
      }

      case "move": {
        if (!taskId || !body.toStatus) {
          return NextResponse.json({ error: "taskId and toStatus are required" }, { status: 400 });
        }
        const task = await moveTask(taskId, body.toStatus, principal);
        return NextResponse.json({ success: true, task });
      }

      case "update": {
        if (!taskId) {
          return NextResponse.json({ error: "taskId is required" }, { status: 400 });
        }
        const patch: UpdateTaskPatch = body.patch ?? {
          title: body.title,
          description: body.description,
          priority: body.priority,
          status: body.status,
          assignedAgent: body.assignedAgent,
          assignedAgents: body.assignedAgents,
          workflowId: body.workflowId,
          parentTaskId: body.parentTaskId,
          dependencies: body.dependencies,
        };
        const task = await updateTask(taskId, patch, principal);
        return NextResponse.json({ success: true, task });
      }

      case "start": {
        if (!taskId) {
          return NextResponse.json({ error: "taskId is required" }, { status: 400 });
        }
        const result = await startTask(taskId, principal);
        return NextResponse.json(result);
      }

      case "retry": {
        if (!taskId) {
          return NextResponse.json({ error: "taskId is required" }, { status: 400 });
        }
        const result = await retryTask(taskId, principal);
        return NextResponse.json(result);
      }

      case "pause":
      case "resume": {
        if (!taskId) {
          return NextResponse.json({ error: "taskId is required" }, { status: 400 });
        }
        const result = await setTaskPaused(taskId, action === "pause", principal);
        return NextResponse.json(result);
      }

      case "cancel": {
        if (!taskId) {
          return NextResponse.json({ error: "taskId is required" }, { status: 400 });
        }
        const result = await cancelTask(taskId, principal);
        return NextResponse.json(result);
      }

      case "delete": {
        if (!taskId) {
          return NextResponse.json({ error: "taskId is required" }, { status: 400 });
        }
        const result = await deleteTask(taskId, principal);
        return NextResponse.json(result);
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof TaskActionError) {
      return NextResponse.json(
        { error: err.message, blockedBy: err.blockedBy },
        { status: err.statusCode },
      );
    }
    const message = err instanceof Error ? err.message : "Unexpected server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
