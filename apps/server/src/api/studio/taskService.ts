import type { StudioStore, StudioTask } from "../../../../../src/studio/contracts";
import type { RequestPrincipal } from "../../auth/principal";
import { ApiError } from "../shared/http";
import { requireResource } from "./resource";

export class TaskService {
  constructor(private readonly store: StudioStore) {}
  list(principal: RequestPrincipal) { return this.store.listTasks(principal); }
  async get(id: string, principal: RequestPrincipal) { return requireResource(await this.store.getTask(id, principal), "Task"); }
  async save(id: string, body: StudioTask, principal: RequestPrincipal) {
    if (body.id !== id) throw new ApiError(400, "Task id mismatch");
    const existing = await this.get(id, principal);
    return this.store.saveTask({ ...body, id, tenantId: principal.tenantId, ownerId: existing.ownerId ?? principal.userId }, principal);
  }
  create(body: StudioTask, principal: RequestPrincipal) { return this.store.saveTask({ ...body, tenantId: principal.tenantId, ownerId: principal.userId }, principal); }
  async delete(id: string, principal: RequestPrincipal) { await this.get(id, principal); await this.store.deleteTask(id, principal); }
  async replace(tasks: StudioTask[], principal: RequestPrincipal) {
    if (!Array.isArray(tasks)) throw new ApiError(400, "Expected task array");
    const existing = await this.store.listTasks(principal); const keep = new Set(tasks.map((task) => task.id));
    for (const task of existing) if (!keep.has(task.id)) await this.store.deleteTask(task.id, principal);
    for (const task of tasks) await this.store.saveTask({ ...task, tenantId: principal.tenantId, ownerId: task.ownerId ?? principal.userId }, principal);
    return this.store.listTasks(principal);
  }
}
