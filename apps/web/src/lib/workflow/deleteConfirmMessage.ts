/**
 * Builds the browser confirm copy for permanent workflow deletion.
 * Keep wording aligned with agent/tool delete prompts.
 */
export function deleteWorkflowConfirmMessage(name: string, dirty = false): string {
  const label = name.trim() || "Untitled Workflow";
  const permanent = `Delete workflow “${label}”? This cannot be undone.`;
  if (!dirty) return permanent;
  return `${permanent} Your unsaved edits in this editor will be discarded.`;
}
