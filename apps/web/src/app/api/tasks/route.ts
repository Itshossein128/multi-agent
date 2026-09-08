import { NextResponse } from "next/server";
import {
  TaskActionError,
  cancelTask,
  createTask,
  getBoardData,
  moveTask,
  retryTask,
  setTaskPaused,
  updateTask,
  UpdateTaskPatch,
} from "@/lib/taskBoard";
import { TaskPriority, TaskStatus } from "@/lib/taskStatus";

export const dynamic = "force-dynamic";

export async function GET() {
  const board = await getBoardData();
  return NextResponse.json(board);
}

interface TaskActionBody {
  action?: string;
  taskId?: string;
  // create
  title?: string;
  description?: string;
  priority?: TaskPriority;
  assignedAgent?: string | null;
  dependencies?: string[];
  status?: TaskStatus;
  // move
  toStatus?: TaskStatus;
  // pause / resume
  paused?: boolean;
  // update
  patch?: UpdateTaskPatch;
}

export async function POST(request: Request) {
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
          dependencies: body.dependencies ?? [],
          status: body.status,
        });
        return NextResponse.json({ success: true, task });
      }

      case "move": {
        if (!taskId || !body.toStatus) {
          return NextResponse.json({ error: "taskId and toStatus are required" }, { status: 400 });
        }
        const task = await moveTask(taskId, body.toStatus);
        return NextResponse.json({ success: true, task });
      }

      case "update": {
        if (!taskId) {
          return NextResponse.json({ error: "taskId is required" }, { status: 400 });
        }
        const task = await updateTask(taskId, body.patch ?? {});
        return NextResponse.json({ success: true, task });
      }

      case "retry": {
        if (!taskId) {
          return NextResponse.json({ error: "taskId is required" }, { status: 400 });
        }
        const task = await retryTask(taskId);
        return NextResponse.json({ success: true, task });
      }

      case "pause":
      case "resume": {
        if (!taskId) {
          return NextResponse.json({ error: "taskId is required" }, { status: 400 });
        }
        const task = await setTaskPaused(taskId, action === "pause");
        return NextResponse.json({ success: true, task });
      }

      case "cancel": {
        if (!taskId) {
          return NextResponse.json({ error: "taskId is required" }, { status: 400 });
        }
        const result = await cancelTask(taskId);
        return NextResponse.json({ success: true, ...result });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof TaskActionError) {
      return NextResponse.json(
        { error: err.message, blockedBy: err.blockedBy },
        { status: err.statusCode }
      );
    }
    const message = err instanceof Error ? err.message : "Unexpected server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
