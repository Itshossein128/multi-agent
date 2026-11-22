"use client";

import { useOrgPath } from "@/components/organization/OrgProvider";
import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  LayoutDashboard,
  Lock,
  Pencil,
  Play,
  RefreshCw,
  Save,
  Settings2,
  Trash2,
  Workflow,
  Wrench,
  X,
} from "lucide-react";
import {
  assertNoCredentials,
  TOOL_CATEGORIES,
  TOOL_IMPACTS,
  validateTool,
  type ToolRecord,
} from "@multi-agent/types";
import { PageContainer } from "@/components/layout/PageContainer";
import { workflowService } from "@/services/workflowService";
import { Button } from "@/components/ui/button";
import { useToolDetail } from "@/hooks/useToolDetail";
import { Field, fieldClass, Section } from "@/components/agents/AgentFields";
import { ToolAssignedAgents, ToolWorkflowUsage } from "./ToolResources";
import { ToolTestPanel } from "./ToolTestPanel";
import { formatDateTime } from "@/lib/formatDateTime";
import { toast } from "@/store/useToastStore";

const sections = ["Overview", "Configuration", "Agents", "Workflows", "Test"] as const;
type SectionName = (typeof sections)[number];

const SECTION_ICONS: Record<SectionName, ComponentType<{ className?: string }>> = {
  Overview: LayoutDashboard,
  Configuration: Settings2,
  Agents: Bot,
  Workflows: Workflow,
  Test: Play,
};

export function ToolDetail({ toolId }: { toolId: string }) {
  const orgUrl = useOrgPath();
  const router = useRouter();
  const detail = useToolDetail(toolId);
  const [draft, setDraft] = useState<ToolRecord | null>(null);
  const [editing, setEditing] = useState(false);
  const [section, setSection] = useState<SectionName>("Overview");
  const [metadata, setMetadata] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [copiedId, setCopiedId] = useState(false);

  const errorRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const tool = draft ?? detail.tool.data;
  const dirty = Boolean(
    draft &&
      (JSON.stringify(draft) !== JSON.stringify(detail.tool.data) ||
        metadata !== JSON.stringify(detail.tool.data?.metadata, null, 2)),
  );
  const busy = detail.save.isPending || detail.remove.isPending;

  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);

  useEffect(() => {
    if (errors.length) errorRef.current?.focus();
  }, [errors]);

  useEffect(() => {
    const activeTab = tabRefs.current[section];
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [section]);

  const navigate = (url: string) => {
    if (!dirty || window.confirm("Discard unsaved tool changes?")) router.push(orgUrl(url));
  };

  const update = (patch: Partial<ToolRecord>) => {
    try {
      assertNoCredentials(patch);
      if (draft) setDraft({ ...draft, ...patch });
      setNotice("");
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    }
  };

  const beginEdit = () => {
    if (!detail.tool.data) return;
    setDraft(structuredClone(detail.tool.data));
    setMetadata(JSON.stringify(detail.tool.data.metadata, null, 2));
    setEditing(true);
    setErrors([]);
    setNotice("");
  };

  const save = async () => {
    if (!draft) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(metadata);
    } catch {
      setErrors(["Metadata must be a valid JSON object."]);
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setErrors(["Metadata must be a JSON object."]);
      return;
    }
    const candidate = { ...draft, metadata: parsed as ToolRecord["metadata"] };
    const validation = validateTool(candidate);
    if (validation.length) {
      setErrors(validation);
      return;
    }
    try {
      await detail.save.mutateAsync(candidate);
      setDraft(null);
      setEditing(false);
      setErrors([]);
      setNotice("Tool saved.");
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Unable to save tool."]);
    }
  };

  const copyId = async () => {
    if (!tool) return;
    try {
      await navigator.clipboard.writeText(tool.id);
      setCopiedId(true);
      toast("Tool ID copied");
      window.setTimeout(() => setCopiedId(false), 1800);
    } catch {
      toast("Unable to copy ID", "error");
    }
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const focusedIndex = sections.findIndex(
      (name) => tabRefs.current[name] === document.activeElement,
    );
    const currentIndex = focusedIndex >= 0 ? focusedIndex : sections.indexOf(section);
    if (currentIndex < 0) return;
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % sections.length;
    else if (event.key === "ArrowLeft")
      nextIndex = (currentIndex - 1 + sections.length) % sections.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = sections.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      const target = sections[nextIndex];
      setSection(target);
      tabRefs.current[target]?.focus();
    }
  };

  return (
    <PageContainer className="space-y-5">
      {/* Top Breadcrumbs / Quick Navigation */}
      <nav aria-label="Breadcrumbs" className="breadcrumb flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
        <ol className="flex min-w-0 flex-wrap items-center">
          <li>
            <button
              type="button"
              onClick={() => navigate("/org/tools")}
              className="inline-flex min-h-7 cursor-pointer items-center rounded px-1.5 text-indigo-300 transition-colors hover:text-indigo-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Tool registry
            </button>
          </li>
          {tool ? (
            <li className="min-w-0">
              <span
                aria-current="page"
                className="inline-flex min-h-7 max-w-[16rem] items-center truncate px-1 font-medium text-zinc-200 sm:max-w-md"
              >
                {tool.name}
              </span>
            </li>
          ) : null}
        </ol>

        <button
          type="button"
          onClick={() => navigate("/org")}
          className="inline-flex min-h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Back to Graph Editor</span>
        </button>
      </nav>

      {detail.tool.isPending && (
        <div role="status" className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 text-sm text-zinc-400 animate-pulse">
          Loading tool…
        </div>
      )}

      {detail.tool.isError && (
        <Section title="Could not load tool">
          <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300">
            {detail.tool.error.message}
          </p>
          <Button type="button" variant="outline" onClick={() => void detail.tool.refetch()} className="gap-1.5">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Retry
          </Button>
        </Section>
      )}

      {!detail.tool.isPending && !detail.tool.isError && !tool && (
        <Section title="Tool not found">
          <p className="text-sm text-zinc-400">
            No tool with ID <code className="font-mono">{toolId}</code> exists in Studio storage for this account.
          </p>
        </Section>
      )}

      {tool && (
        <>
          <header className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/15 text-amber-300">
                  <Wrench className="h-6 w-6" aria-hidden="true" />
                </div>
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-widest text-amber-300">
                      Tool control
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                        tool.enabled !== false
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                          : "border-zinc-700 bg-zinc-900 text-zinc-400"
                      }`}
                    >
                      {tool.enabled !== false ? "Enabled" : "Disabled"}
                    </span>
                  </div>

                  <h1 className="break-words text-xl font-semibold tracking-tight text-zinc-100 sm:text-2xl">
                    {tool.name}
                  </h1>

                  <p className="max-w-3xl whitespace-pre-wrap text-sm text-zinc-400">
                    {tool.description || "No description yet."}
                  </p>

                  <div className="pt-0.5">
                    <button
                      type="button"
                      onClick={() => void copyId()}
                      aria-label={`Copy ID for ${tool.name}`}
                      className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950/70 px-2.5 py-1 font-mono text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer"
                    >
                      <span className="truncate">{tool.id}</span>
                      {copiedId ? (
                        <Check className="h-3 w-3 shrink-0 text-emerald-400" aria-hidden="true" />
                      ) : (
                        <Copy className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || dirty}
                  onClick={async () => {
                    try {
                      const copy = await workflowService.duplicateTool(toolId);
                      toast("Tool duplicated");
                      router.push(orgUrl(`/org/tools/${copy.id}`));
                    } catch (error) {
                      setErrors([error instanceof Error ? error.message : String(error)]);
                    }
                  }}
                  className="gap-1.5 text-xs"
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  Duplicate
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSection("Test")}
                  className="gap-1.5 text-xs"
                >
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  Test tool
                </Button>
                {!editing ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={beginEdit}
                    disabled={busy}
                    className="gap-1.5 bg-indigo-600 text-xs text-white hover:bg-indigo-500"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    Edit tool
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy || !dirty}
                      onClick={() => void save()}
                      className="gap-1.5 bg-indigo-600 text-xs text-white hover:bg-indigo-500"
                    >
                      <Save className="h-3.5 w-3.5" aria-hidden="true" />
                      {detail.save.isPending ? "Saving…" : "Save"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        if (!dirty || window.confirm("Discard unsaved tool changes?")) {
                          setDraft(null);
                          setEditing(false);
                          setErrors([]);
                        }
                      }}
                      className="gap-1.5 text-xs"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                      Cancel editing
                    </Button>
                  </>
                )}
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={busy || detail.workflows.isPending || detail.workflows.isError}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        `Delete tool “${tool.name}”?${
                          dirty ? " Your unsaved edits in this form will be discarded." : ""
                        }`,
                      )
                    )
                      return;
                    try {
                      await detail.remove.mutateAsync();
                      toast("Tool deleted");
                      router.push(orgUrl("/org/tools"));
                    } catch (error) {
                      setErrors([error instanceof Error ? error.message : "Unable to delete tool."]);
                    }
                  }}
                  className="gap-1.5 text-xs"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Delete
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 border-t border-zinc-800/80 pt-4 sm:grid-cols-4 text-xs">
              <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Category</p>
                <p className="mt-0.5 font-mono text-zinc-200">{tool.category}</p>
              </div>
              <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Impact</p>
                <p className="mt-0.5 font-mono text-zinc-200">{tool.impact}</p>
              </div>
              <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Status</p>
                <p className="mt-0.5 text-zinc-200">{tool.enabled === false ? "Disabled" : "Enabled"}</p>
              </div>
              <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Updated</p>
                <p className="mt-0.5 truncate text-zinc-200">{formatDateTime(tool.updatedAt)}</p>
              </div>
            </div>
          </header>

          {dirty && (
            <div
              role="status"
              className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs font-medium text-amber-200"
            >
              Unsaved changes
            </div>
          )}

          {notice && (
            <div
              role="status"
              className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs font-medium text-emerald-300"
            >
              <span className="inline-flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                {notice}
              </span>
              <button
                type="button"
                aria-label="Dismiss notice"
                onClick={() => setNotice("")}
                className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-emerald-500/20"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          )}

          {!!errors.length && (
            <div
              ref={errorRef}
              tabIndex={-1}
              role="alert"
              className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200 focus:outline-none"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-semibold">Please resolve:</p>
                  <ul className="mt-1 ml-4 list-disc space-y-0.5 text-xs">
                    {errors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Single-Row Scrollable Section Navigation */}
          <nav
            aria-label="Tool sections"
            onKeyDown={handleTabKeyDown}
            className="agent-section-nav"
          >
            {sections.map((name) => {
              const Icon = SECTION_ICONS[name];
              const selected = section === name;
              return (
                <button
                  key={name}
                  ref={(el) => {
                    tabRefs.current[name] = el;
                  }}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setSection(name)}
                  className={`inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
                    selected ? "text-indigo-300" : "text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{name}</span>
                </button>
              );
            })}
          </nav>

          {section === "Configuration" && !editing && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-xs text-zinc-300">
              <span className="inline-flex items-center gap-2">
                <Lock className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                <span>Choose Edit tool to change configuration.</span>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={beginEdit}
                disabled={busy}
                className="h-7 gap-1.5 text-xs"
              >
                <Pencil className="h-3 w-3" aria-hidden="true" />
                Unlock to edit
              </Button>
            </div>
          )}

          {section === "Overview" && (
            <div className="grid gap-5 lg:grid-cols-2">
              <Section title="Tool overview">
                <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                  {Object.entries({
                    Purpose: tool.description || "Not specified",
                    Category: tool.category,
                    Impact: tool.impact,
                    Lifecycle: tool.enabled === false ? "Disabled" : "Enabled",
                    "Configuration fields": Object.keys(tool.configuration).length,
                    "Assigned agents": detail.agents.data
                      ? detail.agents.data.filter((agent) => agent.tools.includes(toolId)).length
                      : "Unavailable",
                  }).map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 p-3">
                      <dt className="text-xs text-zinc-400">{label}</dt>
                      <dd className="mt-1 break-words font-medium text-zinc-100">{value}</dd>
                    </div>
                  ))}
                </dl>
              </Section>
              <Section title="Schemas">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Input</p>
                <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 font-mono text-xs text-zinc-300">
                  {JSON.stringify(tool.inputSchema, null, 2)}
                </pre>
                <p className="mt-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">Output</p>
                <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 font-mono text-xs text-zinc-300">
                  {JSON.stringify(tool.outputSchema, null, 2)}
                </pre>
              </Section>
            </div>
          )}

          {section === "Configuration" && (
            <Section title="General configuration">
              <fieldset disabled={!editing || busy} className="space-y-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={tool.enabled !== false}
                    onChange={(event) => update({ enabled: event.target.checked })}
                    className="h-4 w-4 accent-indigo-500"
                  />
                  Enabled
                </label>
                <Field label="Name">
                  <input
                    className={fieldClass}
                    value={tool.name}
                    onChange={(event) => update({ name: event.target.value })}
                  />
                </Field>
                <Field label="Category">
                  <select
                    className={`studio-select ${fieldClass}`}
                    value={tool.category}
                    onChange={(event) => update({ category: event.target.value as ToolRecord["category"] })}
                  >
                    {TOOL_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Impact / permission level">
                  <select
                    className={`studio-select ${fieldClass}`}
                    value={tool.impact}
                    onChange={(event) => update({ impact: event.target.value as ToolRecord["impact"] })}
                  >
                    {TOOL_IMPACTS.map((impact) => (
                      <option key={impact} value={impact}>
                        {impact}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Description / purpose">
                  <textarea
                    className={fieldClass}
                    rows={3}
                    value={tool.description}
                    onChange={(event) => update({ description: event.target.value })}
                  />
                </Field>
                <Field label="Configuration (JSON, no credentials)">
                  <textarea
                    className={`${fieldClass} font-mono`}
                    rows={8}
                    value={JSON.stringify(tool.configuration, null, 2)}
                    onChange={(event) => {
                      try {
                        const parsed = JSON.parse(event.target.value);
                        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
                          update({ configuration: parsed });
                      } catch {
                        /* keep prior valid state until parseable */
                      }
                    }}
                  />
                </Field>
                <Field label="Metadata (JSON, no credentials)">
                  <textarea
                    className={`${fieldClass} font-mono`}
                    rows={8}
                    value={editing ? metadata : JSON.stringify(tool.metadata, null, 2)}
                    onChange={(event) => setMetadata(event.target.value)}
                  />
                </Field>
              </fieldset>
            </Section>
          )}

          {section === "Test" && <ToolTestPanel tool={detail.tool.data ?? tool} dirty={dirty} />}
          {(section === "Agents" || section === "Workflows") &&
            (detail.agents.isPending || detail.workflows.isPending) && (
              <p role="status" className="text-sm text-zinc-400">
                Loading usage data…
              </p>
            )}
          {section === "Agents" && detail.agents.data && (
            <ToolAssignedAgents toolId={toolId} agents={detail.agents.data} />
          )}
          {section === "Workflows" && detail.workflows.data && (
            <ToolWorkflowUsage toolId={toolId} workflows={detail.workflows.data} navigate={navigate} />
          )}
        </>
      )}
    </PageContainer>
  );
}
