/**
 * Undo/redo history for workflow editing. Snapshot-based with a bounded stack
 * and coalescing of rapid successive edits under the same key so a burst of
 * keystrokes does not flood the undo stack.
 *
 * Extracted from useWorkflowStore so history semantics are independently
 * testable and the store stays focused on state transitions.
 */

import { cloneDefinition } from "./workflowDefinition";
import type { WorkflowDefinition } from "@/lib/workflow/types";

export const HISTORY_LIMIT = 50;
export const CONFIG_EDIT_COALESCE_MS = 900;

export class WorkflowHistory {
  private undoStack: WorkflowDefinition[] = [];
  private redoStack: WorkflowDefinition[] = [];
  private lastEditKey: { key: string; at: number } | null = null;

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Snapshot the current definition before a mutation. */
  push(definition: WorkflowDefinition): void {
    this.undoStack = [...this.undoStack.slice(-(HISTORY_LIMIT - 1)), cloneDefinition(definition)];
    this.redoStack = [];
    this.lastEditKey = null;
  }

  /** Push a snapshot unless it belongs to the same rapid edit burst. */
  pushCoalesced(definition: WorkflowDefinition, key: string, now = Date.now()): void {
    if (this.lastEditKey && this.lastEditKey.key === key && now - this.lastEditKey.at < CONFIG_EDIT_COALESCE_MS) {
      this.lastEditKey = { key, at: now };
      return;
    }
    this.lastEditKey = { key, at: now };
    this.undoStack = [...this.undoStack.slice(-(HISTORY_LIMIT - 1)), cloneDefinition(definition)];
    this.redoStack = [];
  }

  /** Restore the previous definition, pushing the current one onto redo. */
  undo(current: WorkflowDefinition): WorkflowDefinition | undefined {
    const previous = this.undoStack.pop();
    if (!previous) return undefined;
    this.redoStack = [...this.redoStack.slice(-(HISTORY_LIMIT - 1)), cloneDefinition(current)];
    this.lastEditKey = null;
    return previous;
  }

  /** Reapply the most recently undone definition. */
  redo(current: WorkflowDefinition): WorkflowDefinition | undefined {
    const next = this.redoStack.pop();
    if (!next) return undefined;
    this.undoStack = [...this.undoStack.slice(-(HISTORY_LIMIT - 1)), cloneDefinition(current)];
    this.lastEditKey = null;
    return next;
  }

  /** History is invalidated when a fresh definition is loaded or registries change. */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.lastEditKey = null;
  }
}
