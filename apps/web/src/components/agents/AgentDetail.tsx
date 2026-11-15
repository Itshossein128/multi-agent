"use client";

import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  History,
  LayoutDashboard,
  Lock,
  Pencil,
  Play,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  Workflow,
  Wrench,
  X,
} from "lucide-react";
import { assertNoCredentials, type AgentRecord } from "@multi-agent/types";
import { useOrgPath } from "@/components/organization/OrgProvider";
import { PageContainer } from "@/components/layout/PageContainer";
import { workflowService } from "@/services/workflowService";
import { Button } from "@/components/ui/button";
import { useAgentDetail, useAgentRunEvents } from "@/hooks/useAgentDetail";
import { runDuration, validateAgentConfiguration } from "@/lib/agentConfiguration";
import { formatDateTime } from "@/lib/formatDateTime";
import { toast } from "@/store/useToastStore";
import { AgentMemoryPanel } from "./AgentMemoryPanel";
import { AgentTestPanel } from "./AgentTestPanel";
import { AgentBackendPanel, ExecutionPolicyPanel } from "./AgentBackendPanel";
import { AgentToolsPanel, AgentWorkflowUsage } from "./AgentResources";
import { AgentExecutionHistory } from "./AgentExecutionHistory";
import { Field, fieldClass, Section } from "./AgentFields";
import { AgentHeartbeatPanel } from "./AgentHeartbeatPanel";

const sections = [
  "Overview",
  "Configuration",
  "Backend",
  "Heartbeat",
  "Tools",
  "Memory",
  "Workflows",
  "Executions",
  "Test",
] as const;

type SectionName = (typeof sections)[number];

const SECTION_ICONS: Record<SectionName, ComponentType<{ className?: string }>> = {
  Overview: LayoutDashboard,
  Configuration: Settings2,
  Backend: Cpu,
  Heartbeat: Activity,
  Tools: Wrench,
  Memory: Brain,
  Workflows: Workflow,
  Executions: History,
  Test: Play,
};

function runtimeBadgeClass(status: string): string {
  switch (status) {
    case "running":
      return "border-indigo-500/30 bg-indigo-500/10 text-indigo-300";
    case "waiting":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300 [html[data-appearance='light']_&]:text-amber-700";
    case "failed":
      return "border-red-500/30 bg-red-500/10 text-red-300 [html[data-appearance='light']_&]:text-red-700";
    default:
      return "border-zinc-700 bg-zinc-900 text-zinc-300";
  }
}

function resolveModelLabel(backend: AgentRecord["backend"]): string {
  if ("model" in backend && backend.model) return backend.model;
  if (backend.type === "process") return backend.command;
  if (backend.type === "webhook") return backend.url;
  return "Runtime default";
}

function AgentSkeleton() {
  return (
    <div role="status" aria-label="Loading agent" className="space-y-6 animate-pulse">
      <span className="sr-only">Loading agent…</span>
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-xl bg-zinc-800" />
            <div className="space-y-2">
              <div className="h-6 w-56 rounded bg-zinc-800" />
              <div className="h-4 w-80 max-w-full rounded bg-zinc-900" />
              <div className="h-5 w-40 rounded bg-zinc-900" />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="h-8 w-24 rounded-lg bg-zinc-800" />
            <div className="h-8 w-24 rounded-lg bg-zinc-800" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-20 rounded-xl border border-zinc-800 bg-zinc-900/40" />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="h-64 rounded-xl border border-zinc-800 bg-zinc-900/40 lg:col-span-7" />
        <div className="h-64 rounded-xl border border-zinc-800 bg-zinc-900/40 lg:col-span-5" />
      </div>
    </div>
  );
}

export function AgentDetail({ agentId }: { agentId: string }) {
  const orgUrl = useOrgPath();
  const router = useRouter();
  const detail = useAgentDetail(agentId);
  const latestRun = detail.runs.data?.[0];
  const latestEvents = useAgentRunEvents(agentId, latestRun?.id ?? null);
  const lastActivity = latestEvents.data
    ?.filter((event) => event.type.startsWith("agent.") || event.type.startsWith("human_approval."))
    .at(-1);
  const runtimeStatus =
    latestRun?.status === "failed"
      ? "failed"
      : latestRun?.status === "waiting_for_human"
        ? "waiting"
        : latestRun?.status === "running" || latestRun?.status === "queued"
          ? "running"
          : lastActivity?.type === "agent.failed"
            ? "failed"
            : "idle";

  const [draft, setDraft] = useState<AgentRecord | null>(null);
  const [editing, setEditing] = useState(false);
  const [section, setSection] = useState<SectionName>("Overview");
  const [metadata, setMetadata] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [copiedId, setCopiedId] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const errorRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const agent = draft ?? detail.agent.data;
  const dirty = Boolean(
    draft &&
      (JSON.stringify(draft) !== JSON.stringify(detail.agent.data) ||
        metadata !== JSON.stringify(detail.agent.data?.metadata, null, 2)),
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
    if (!dirty || window.confirm("Discard unsaved agent changes?")) {
      router.push(orgUrl(url));
    }
  };

  const update = (patch: Partial<AgentRecord>) => {
    try {
      assertNoCredentials(patch);
      if (draft) setDraft({ ...draft, ...patch });
      setNotice("");
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    }
  };

  const beginEdit = () => {
    if (!detail.agent.data) return;
    setDraft(structuredClone(detail.agent.data));
    setMetadata(JSON.stringify(detail.agent.data.metadata, null, 2));
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
    const candidate = { ...draft, metadata: parsed as AgentRecord["metadata"] };
    const validation = validateAgentConfiguration(candidate);
    if (validation.length) {
      setErrors(validation);
      return;
    }
    try {
      await detail.save.mutateAsync(candidate);
      setDraft(null);
      setEditing(false);
      setErrors([]);
      setNotice("Agent saved.");
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Unable to save agent."]);
    }
  };

  const copyId = async () => {
    if (!agent) return;
    try {
      await navigator.clipboard.writeText(agent.id);
      setCopiedId(true);
      toast("Agent ID copied");
      window.setTimeout(() => setCopiedId(false), 1800);
    } catch {
      toast("Unable to copy ID", "error");
    }
  };

  const copyPrompt = async () => {
    if (!agent?.systemPrompt) return;
    try {
      await navigator.clipboard.writeText(agent.systemPrompt);
      setCopiedPrompt(true);
      toast("System prompt copied");
      window.setTimeout(() => setCopiedPrompt(false), 1800);
    } catch {
      toast("Unable to copy prompt", "error");
    }
  };

  const formatMetadata = () => {
    try {
      const parsed = JSON.parse(metadata);
      setMetadata(JSON.stringify(parsed, null, 2));
      setErrors([]);
    } catch {
      setErrors(["Metadata must be a valid JSON object."]);
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

  const savedWorkflowCount = detail.workflows.data
    ? detail.workflows.data.filter((workflow) =>
        workflow.nodes.some(
          (node) => node.type === "agent" && (node.config as { agentId?: string }).agentId === agentId,
        ),
      ).length
    : null;

  const isEditableSection =
    section === "Configuration" ||
    section === "Backend" ||
    section === "Tools" ||
    section === "Memory";

  return (
    <PageContainer>
        {/* Top Breadcrumbs / Quick Navigation */}
        <nav aria-label="Breadcrumbs" className="breadcrumb flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
          <ol className="flex min-w-0 flex-wrap items-center">
            <li>
              <button
                type="button"
                onClick={() => navigate("/org/agents")}
                className="inline-flex min-h-7 cursor-pointer items-center rounded px-1.5 text-indigo-300 transition-colors hover:text-indigo-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                Agent registry
              </button>
            </li>
            {agent ? (
              <li className="min-w-0">
                <span
                  aria-current="page"
                  className="inline-flex min-h-7 max-w-[16rem] items-center truncate px-1 font-medium text-zinc-200 sm:max-w-md"
                >
                  {agent.name}
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

        {detail.agent.isPending ? <AgentSkeleton /> : null}

        {detail.agent.isError ? (
          <Section title="Could not load agent">
            <p
              role="alert"
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300 [html[data-appearance='light']_&]:text-red-700"
            >
              {detail.agent.error.message}
            </p>
            <Button type="button" variant="outline" onClick={() => void detail.agent.refetch()} className="gap-1.5">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Retry
            </Button>
          </Section>
        ) : null}

        {!detail.agent.isPending && !detail.agent.isError && !agent ? (
          <Section title="Agent not found">
            <p className="text-sm text-zinc-400">
              No agent with ID <code className="font-mono">{agentId}</code> exists in Studio storage for this account.
            </p>
          </Section>
        ) : null}

        {agent ? (
          <>
            {/* Redesigned Agent Header Card */}
            <header className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-indigo-500/30 bg-indigo-500/15 text-indigo-300">
                    <Bot className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-widest text-indigo-300">
                        Agent control
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                          agent.enabled !== false
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 [html[data-appearance='light']_&]:text-emerald-700"
                            : "border-zinc-700 bg-zinc-900 text-zinc-400"
                        }`}
                      >
                        {agent.enabled !== false ? "Enabled" : "Disabled"}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${runtimeBadgeClass(runtimeStatus)}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            runtimeStatus === "running"
                              ? "animate-pulse bg-indigo-400"
                              : runtimeStatus === "failed"
                                ? "bg-red-400"
                                : runtimeStatus === "waiting"
                                  ? "bg-amber-400"
                                  : "bg-zinc-400"
                          }`}
                          aria-hidden="true"
                        />
                        {runtimeStatus}
                      </span>
                    </div>

                    <h1 className="break-words text-xl font-semibold tracking-tight text-zinc-100 sm:text-2xl">
                      {agent.name}
                    </h1>

                    <p className="max-w-3xl whitespace-pre-wrap text-sm text-zinc-400">
                      {agent.description || "No description yet."}
                    </p>

                    <div className="pt-0.5">
                      <button
                        type="button"
                        onClick={() => void copyId()}
                        aria-label={`Copy ID for ${agent.name}`}
                        className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950/70 px-2.5 py-1 font-mono text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        <span className="truncate">{agent.id}</span>
                        {copiedId ? (
                          <Check className="h-3 w-3 shrink-0 text-emerald-400" aria-hidden="true" />
                        ) : (
                          <Copy className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Action Toolbar */}
                <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || dirty}
                    onClick={async () => {
                      try {
                        const copy = await workflowService.duplicateAgent(agentId);
                        toast("Agent duplicated");
                        router.push(orgUrl(`/org/agents/${copy.id}`));
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
                    Test agent
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
                      Edit agent
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
                          if (!dirty || window.confirm("Discard unsaved agent changes?")) {
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
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setSection("Workflows")}
                    className="gap-1.5 text-xs"
                  >
                    <Workflow className="h-3.5 w-3.5" aria-hidden="true" />
                    Open in Graph
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy || detail.workflows.isPending || detail.workflows.isError}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          `Delete agent “${agent.name}”?${
                            dirty ? " Your unsaved edits in this form will be discarded." : ""
                          }`,
                        )
                      ) {
                        return;
                      }
                      try {
                        await detail.remove.mutateAsync();
                        toast("Agent deleted");
                        router.push(orgUrl("/org"));
                      } catch (error) {
                        setErrors([
                          error instanceof Error ? error.message : "Unable to delete agent.",
                        ]);
                      }
                    }}
                    className="gap-1.5 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300 [html[data-appearance='light']_&]:text-red-700 [html[data-appearance='light']_&]:hover:text-red-800"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Delete
                  </Button>
                </div>
              </div>

              {/* Compact Telemetry Strip */}
              <div className="grid grid-cols-2 gap-3 border-t border-zinc-800/80 pt-4 lg:grid-cols-4">
                <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                    Last observed status
                  </p>
                  <p className="mt-0.5 truncate text-xs font-medium capitalize text-zinc-200">
                    {runtimeStatus}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                    Backend &amp; Model
                  </p>
                  <p className="mt-0.5 truncate font-mono text-xs text-zinc-200">
                    {agent.backend.type} / {agent.backend.provider} ·{" "}
                    {resolveModelLabel(agent.backend)}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                    Updated
                  </p>
                  <p className="mt-0.5 truncate text-xs text-zinc-200">
                    {formatDateTime(agent.updatedAt)}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                    Last execution
                  </p>
                  <p className="mt-0.5 truncate text-xs text-zinc-200">
                    {latestRun?.startedAt
                      ? formatDateTime(latestRun.startedAt)
                      : detail.runs.isError
                        ? "Unavailable"
                        : detail.runs.isPending
                          ? "Loading…"
                          : "None recorded"}
                  </p>
                </div>
              </div>
            </header>

            {/* Feedback & Validation Banners */}
            {dirty ? (
              <div
                role="status"
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200 [html[data-appearance='light']_&]:text-amber-700"
              >
                <span className="font-medium">
                  Unsaved changes — review your edits and click Save in the header when ready.
                </span>
              </div>
            ) : null}

            {notice ? (
              <div
                role="status"
                className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-300 [html[data-appearance='light']_&]:text-emerald-700"
              >
                <span className="inline-flex items-center gap-2 font-medium">
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {notice}
                </span>
                <button
                  type="button"
                  onClick={() => setNotice("")}
                  aria-label="Dismiss notice"
                  className="inline-flex min-h-7 min-w-7 items-center justify-center rounded hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : null}

            {errors.length > 0 ? (
              <div
                ref={errorRef}
                tabIndex={-1}
                role="alert"
                className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200 focus:outline-none [html[data-appearance='light']_&]:text-red-700"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <div>
                      <p className="font-semibold">Please resolve:</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
                        {errors.map((error) => (
                          <li key={error}>{error}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setErrors([])}
                    aria-label="Dismiss errors"
                    className="inline-flex min-h-7 min-w-7 items-center justify-center rounded hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ) : null}

            {/* Single-Row Scrollable Section Navigation */}
            <nav
              ref={navRef}
              aria-label="Agent sections"
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
                      selected
                        ? "text-indigo-300"
                        : "text-zinc-400 hover:text-zinc-100"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{name}</span>
                  </button>
                );
              })}
            </nav>

            {/* Helpful Edit-mode Context Callout for Editable Sections */}
            {isEditableSection && !editing ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-xs text-zinc-300">
                <span className="inline-flex items-center gap-2">
                  <Lock className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                  <span>
                    Read-only view. Choose <strong>Edit agent</strong> above or unlock below to modify fields.
                  </span>
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
            ) : null}

            {/* Section Content */}
            {section === "Overview" ? (
              <div className="space-y-5">
                {/* Summary Metric Strip */}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                      Backend
                    </p>
                    <p className="mt-1 truncate text-sm font-semibold text-zinc-100">
                      {agent.backend.type} / {agent.backend.provider}
                    </p>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                      Assigned tools
                    </p>
                    <p className="mt-1 text-lg font-semibold text-zinc-100">
                      {agent.tools.length}
                    </p>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                      Saved workflows
                    </p>
                    <p className="mt-1 text-lg font-semibold text-zinc-100">
                      {savedWorkflowCount ?? "Unavailable"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                      Last run status
                    </p>
                    <p className="mt-1 truncate text-sm font-semibold text-zinc-100">
                      {detail.runs.isError
                        ? "Unavailable"
                        : detail.runs.data?.[0]?.status ?? "No executions"}
                    </p>
                  </div>
                </div>

                {/* Balanced 12-column Overview Grid */}
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                  <div className="space-y-5 lg:col-span-7">
                    <Section
                      title="System prompt"
                      description={
                        agent.systemPrompt
                          ? `${agent.systemPrompt.length} characters · ${agent.systemPrompt.split("\n").length} lines`
                          : "No prompt configured yet"
                      }
                      action={
                        agent.systemPrompt ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void copyPrompt()}
                            className="h-7 gap-1.5 text-xs"
                          >
                            {copiedPrompt ? (
                              <Check className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                            ) : (
                              <Copy className="h-3 w-3" aria-hidden="true" />
                            )}
                            {copiedPrompt ? "Copied" : "Copy prompt"}
                          </Button>
                        ) : null
                      }
                    >
                      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-zinc-950/60 p-3.5 font-mono text-xs leading-relaxed text-zinc-200">
                        {agent.systemPrompt || "No system prompt configured."}
                      </pre>
                    </Section>

                    <Section title="Agent overview">
                      <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="text-xs text-zinc-400">Purpose</dt>
                          <dd className="mt-1 break-words text-zinc-100">
                            {agent.description || "Not specified"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-zinc-400">Model</dt>
                          <dd className="mt-1 break-words font-mono text-xs text-zinc-100">
                            {resolveModelLabel(agent.backend)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-zinc-400">Last run duration</dt>
                          <dd className="mt-1 font-mono text-xs text-zinc-100">
                            {detail.runs.data?.[0]
                              ? runDuration(
                                  detail.runs.data[0].startedAt,
                                  detail.runs.data[0].completedAt,
                                )
                              : "Not available"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-zinc-400">Memory</dt>
                          <dd className="mt-1 text-zinc-100">
                            {agent.memory?.enabled
                              ? `Run / ${agent.memory.scope} / ${agent.memory.mode}`
                              : "Disabled"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-zinc-400">Lifecycle</dt>
                          <dd className="mt-1 text-zinc-100">
                            {agent.enabled === false ? "Disabled" : "Enabled"}
                          </dd>
                        </div>
                      </dl>
                    </Section>
                  </div>

                  <div className="space-y-5 lg:col-span-5">
                    <Section title="Backend health">
                      {detail.diagnostics.isPending ? (
                        <p role="status" className="text-sm text-zinc-400">
                          Checking execution server…
                        </p>
                      ) : null}
                      {detail.diagnostics.isError ? (
                        <p
                          role="alert"
                          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300 [html[data-appearance='light']_&]:text-red-700"
                        >
                          Diagnostics unavailable: {detail.diagnostics.error.message}
                        </p>
                      ) : null}
                      {detail.diagnostics.data ? (
                        <div className="space-y-2.5">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                              detail.diagnostics.data.status === "ready"
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 [html[data-appearance='light']_&]:text-emerald-700"
                                : "border-amber-500/30 bg-amber-500/10 text-amber-300 [html[data-appearance='light']_&]:text-amber-700"
                            }`}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            {detail.diagnostics.data.status}
                          </span>
                          <p className="text-sm text-zinc-200">{detail.diagnostics.data.message}</p>
                          <p className="text-xs text-zinc-500">
                            Checked {formatDateTime(detail.diagnostics.data.checkedAt)} by the execution server. Credentials and credential files are never returned.
                          </p>
                        </div>
                      ) : null}
                    </Section>

                    <Section title="Quick sections" description="Jump directly to configuration and runtime tools.">
                      <div className="grid grid-cols-2 gap-2">
                        {(
                          [
                            ["Configuration", "Edit configuration"],
                            ["Backend", "Inspect backend"],
                            ["Tools", "Manage tools"],
                            ["Executions", "View executions"],
                          ] as const
                        ).map(([target, label]) => {
                          const Icon = SECTION_ICONS[target];
                          return (
                            <Button
                              key={target}
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setSection(target)}
                              className="justify-start gap-2 text-xs"
                            >
                              <Icon className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                              <span>{label}</span>
                            </Button>
                          );
                        })}
                      </div>
                    </Section>
                  </div>
                </div>
              </div>
            ) : null}

            {section === "Configuration" ? (
              <Section
                title="General configuration"
                description="Identity, system prompt instructions, and non-credential metadata."
                action={
                  editing ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={formatMetadata}
                      className="h-7 gap-1.5 text-xs"
                    >
                      <Sparkles className="h-3 w-3" aria-hidden="true" />
                      Format metadata
                    </Button>
                  ) : null
                }
              >
                {!editing ? (
                  <p className="sr-only">Choose Edit agent to change configuration.</p>
                ) : null}
                <fieldset disabled={!editing || busy} className="space-y-4">
                  <label className="flex min-h-7 cursor-pointer items-center gap-2 text-sm text-zinc-200">
                    <input
                      type="checkbox"
                      checked={agent.enabled !== false}
                      onChange={(event) => update({ enabled: event.target.checked })}
                      className="h-4 w-4 rounded accent-indigo-500"
                    />
                    <span>Enabled for execution</span>
                  </label>
                  <Field label="Name">
                    <input
                      className={fieldClass}
                      value={agent.name}
                      onChange={(event) => update({ name: event.target.value })}
                    />
                  </Field>
                  <Field label="Description / purpose">
                    <textarea
                      className={fieldClass}
                      rows={3}
                      value={agent.description}
                      onChange={(event) => update({ description: event.target.value })}
                    />
                  </Field>
                  <Field
                    label="System prompt"
                    hint={`${agent.systemPrompt.length} characters · ${agent.systemPrompt.split("\n").length} lines`}
                  >
                    <textarea
                      className={`${fieldClass} min-h-80 font-mono leading-relaxed`}
                      rows={16}
                      value={agent.systemPrompt}
                      onChange={(event) => update({ systemPrompt: event.target.value })}
                    />
                  </Field>
                  <Field label="Metadata (JSON, no credentials)">
                    <textarea
                      className={`${fieldClass} font-mono`}
                      rows={8}
                      value={editing ? metadata : JSON.stringify(agent.metadata, null, 2)}
                      onChange={(event) => setMetadata(event.target.value)}
                    />
                  </Field>
                </fieldset>
              </Section>
            ) : null}

            {section === "Backend" ? (
              <fieldset disabled={!editing || busy} className="space-y-5">
                <AgentBackendPanel
                  backend={agent.backend}
                  onChange={(backend) => update({ backend })}
                />
                <ExecutionPolicyPanel
                  policy={agent.executionPolicy}
                  onChange={(executionPolicy) => update({ executionPolicy })}
                />
              </fieldset>
            ) : null}

            {section === "Heartbeat" ? <AgentHeartbeatPanel agentId={agentId} /> : null}

            {section === "Test" ? (
              <AgentTestPanel agent={detail.agent.data ?? agent} dirty={dirty} />
            ) : null}

            {(section === "Tools" || section === "Workflows") && detail.workflows.isPending ? (
              <p role="status" className="text-sm text-zinc-400">
                Loading saved workflows…
              </p>
            ) : null}

            {(section === "Tools" || section === "Workflows") && detail.workflows.isError ? (
              <Section title="Workflow data unavailable">
                <p
                  role="alert"
                  className="text-sm text-red-300 [html[data-appearance='light']_&]:text-red-700"
                >
                  {detail.workflows.error.message}
                </p>
                <Button type="button" variant="outline" onClick={() => void detail.workflows.refetch()}>
                  Retry
                </Button>
              </Section>
            ) : null}

            {section === "Tools" ? (
              <AgentToolsPanel
                agent={agent}
                tools={detail.tools.data ?? []}
                editing={editing && !busy}
                onChange={(tools) => update({ tools })}
              />
            ) : null}

            {section === "Memory" ? (
              <fieldset disabled={!editing || busy}>
                <AgentMemoryPanel
                  agentId={agentId}
                  workflows={detail.workflows.data ?? []}
                  memory={agent.memory}
                  onChange={(memory) => update({ memory })}
                />
              </fieldset>
            ) : null}

            {section === "Workflows" && detail.workflows.data ? (
              <AgentWorkflowUsage
                agentId={agentId}
                workflows={detail.workflows.data}
                navigate={navigate}
              />
            ) : null}

            {section === "Executions" ? (
              <div className="space-y-4">
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={detail.runs.isFetching}
                    onClick={() => void detail.runs.refetch()}
                    className="gap-1.5 text-xs"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${detail.runs.isFetching ? "animate-spin" : ""}`}
                      aria-hidden="true"
                    />
                    Refresh runs
                  </Button>
                </div>
                {detail.runs.isPending ? (
                  <p role="status" className="text-sm text-zinc-400">
                    Loading executions…
                  </p>
                ) : null}
                {detail.runs.isError ? (
                  <p
                    role="alert"
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300 [html[data-appearance='light']_&]:text-red-700"
                  >
                    Execution history unavailable: {detail.runs.error.message}. Check the execution server and retry.
                  </p>
                ) : null}
                {detail.runs.data ? (
                  <AgentExecutionHistory
                    agentId={agentId}
                    runs={detail.runs.data}
                    navigate={navigate}
                  />
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
    </PageContainer>
  );
}
