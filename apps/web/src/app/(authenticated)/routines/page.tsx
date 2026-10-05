"use client";

import React, { useEffect, useState } from "react";
import {
  CalendarClock,
  Plus,
  Play,
  Pause,
  Trash2,
  History,
  AlertCircle,
  CheckCircle2,
  Clock,
  RefreshCw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/formatRelativeTime";

interface Routine {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  scheduleType: "cron" | "interval";
  scheduleExpr: string;
  timezone: string;
  targetType: "workflow" | "agent" | "task";
  targetId: string;
  inputPayload: Record<string, unknown>;
  misfirePolicy: "skip" | "coalesce" | "enqueue";
  enabled: boolean;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastStatus?: string | null;
  lastError?: string | null;
  createdAt: string;
}

interface RoutineHistoryItem {
  id: string;
  scheduledAt: string;
  executedAt: string;
  status: "success" | "failed" | "skipped";
  runId?: string | null;
  error?: string | null;
}

export default function RoutinesPage() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scheduleType, setScheduleType] = useState<"cron" | "interval">("cron");
  const [scheduleExpr, setScheduleExpr] = useState("0 9 * * 1-5");
  const [timezone, setTimezone] = useState("UTC");
  const [targetType, setTargetType] = useState<"workflow" | "agent">("workflow");
  const [targetId, setTargetId] = useState("");
  const [misfirePolicy, setMisfirePolicy] = useState<"skip" | "coalesce" | "enqueue">("skip");
  const [previewRuns, setPreviewRuns] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  // History modal state
  const [historyRoutine, setHistoryRoutine] = useState<Routine | null>(null);
  const [historyItems, setHistoryItems] = useState<RoutineHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchRoutines = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/studio/routines");
      if (!res.ok) throw new Error("Failed to load routines");
      const data = await res.json();
      setRoutines(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err?.message || "Failed to load routines");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRoutines();
  }, []);

  const handlePreview = async () => {
    try {
      setFormError(null);
      const res = await fetch("/studio/routines/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduleType,
          scheduleExpr: scheduleExpr.trim(),
          timezone: timezone.trim(),
          count: 5,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to calculate preview");
      }
      const data = await res.json();
      setPreviewRuns(data.previews || []);
    } catch (err: any) {
      setFormError(err?.message || "Invalid schedule expression or timezone");
      setPreviewRuns([]);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !scheduleExpr.trim() || !targetId.trim()) return;

    try {
      setCreating(true);
      setFormError(null);
      const res = await fetch("/studio/routines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          scheduleType,
          scheduleExpr: scheduleExpr.trim(),
          timezone: timezone.trim(),
          targetType,
          targetId: targetId.trim(),
          misfirePolicy,
          enabled: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create routine");
      }

      setModalOpen(false);
      setName("");
      setDescription("");
      setTargetId("");
      setPreviewRuns([]);
      await fetchRoutines();
    } catch (err: any) {
      setFormError(err?.message || "Failed to create routine");
    } finally {
      setCreating(false);
    }
  };

  const handleTogglePause = async (routine: Routine) => {
    try {
      const action = routine.enabled ? "pause" : "resume";
      const res = await fetch(`/studio/routines/${routine.id}/${action}`, {
        method: "POST",
      });
      if (res.ok) {
        await fetchRoutines();
      }
    } catch (err) {
      console.error("Failed to toggle routine status:", err);
    }
  };

  const handleDelete = async (routineId: string) => {
    if (!window.confirm("Are you sure you want to delete this routine? / آیا از حذف این روال اطمینان دارید؟")) {
      return;
    }
    try {
      const res = await fetch(`/studio/routines/${routineId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setRoutines((prev) => prev.filter((r) => r.id !== routineId));
      }
    } catch (err) {
      console.error("Failed to delete routine:", err);
    }
  };

  const openHistory = async (routine: Routine) => {
    setHistoryRoutine(routine);
    try {
      setHistoryLoading(true);
      const res = await fetch(`/studio/routines/${routine.id}/history`);
      if (res.ok) {
        const data = await res.json();
        setHistoryItems(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Failed to load history:", err);
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <CalendarClock className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">
                Recurring Routines / روال‌های زمان‌بندی‌شده
              </h1>
              <p className="text-xs text-zinc-400">
                Automated continuous agent & workflow routines driven by cron or interval schedules.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchRoutines}
            className="gap-1.5 text-xs border-zinc-800 hover:bg-zinc-900 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          <Button
            size="sm"
            onClick={() => {
              setModalOpen(true);
              setFormError(null);
              setPreviewRuns([]);
            }}
            className="gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            Create Routine / تعریف روال
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Routine Cards Grid */}
      {loading && routines.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/20 p-8 text-center text-sm text-zinc-500">
          Loading routines...
        </div>
      ) : routines.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/10 p-12 text-center space-y-3">
          <CalendarClock className="h-8 w-8 text-zinc-600 mx-auto" />
          <h3 className="text-sm font-semibold text-zinc-300">No Routines Configured / هیچ روالی تعریف نشده است</h3>
          <p className="text-xs text-zinc-500 max-w-md mx-auto">
            Routines wake agents or execute workflows automatically on cron or interval schedules.
          </p>
          <Button
            size="sm"
            onClick={() => setModalOpen(true)}
            className="gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer mt-2"
          >
            <Plus className="h-3.5 w-3.5" />
            Create Your First Routine
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {routines.map((routine) => (
            <div
              key={routine.id}
              className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4 hover:border-zinc-700 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-zinc-100">{routine.name}</h3>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                        routine.enabled
                          ? "border-emerald-500/30 bg-emerald-950/30 text-emerald-400"
                          : "border-zinc-700 bg-zinc-800/40 text-zinc-400"
                      }`}
                    >
                      {routine.enabled ? "Active" : "Paused"}
                    </span>
                  </div>
                  {routine.description && (
                    <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{routine.description}</p>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleTogglePause(routine)}
                    className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                    title={routine.enabled ? "Pause routine" : "Resume routine"}
                  >
                    {routine.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 text-emerald-400" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openHistory(routine)}
                    className="h-7 w-7 p-0 text-zinc-400 hover:text-indigo-300 cursor-pointer"
                    title="View execution history"
                  >
                    <History className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(routine.id)}
                    className="h-7 w-7 p-0 text-zinc-500 hover:text-red-400 cursor-pointer"
                    title="Delete routine"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Schedule Info */}
              <div className="grid grid-cols-2 gap-2 text-xs border-t border-zinc-800/80 pt-3">
                <div>
                  <span className="text-[11px] text-zinc-500">Schedule ({routine.scheduleType})</span>
                  <p className="font-mono text-zinc-200 mt-0.5">{routine.scheduleExpr}</p>
                </div>
                <div>
                  <span className="text-[11px] text-zinc-500">Timezone</span>
                  <p className="font-mono text-zinc-200 mt-0.5">{routine.timezone}</p>
                </div>
                <div>
                  <span className="text-[11px] text-zinc-500">Target ({routine.targetType})</span>
                  <p className="font-mono text-zinc-200 mt-0.5 truncate">{routine.targetId}</p>
                </div>
                <div>
                  <span className="text-[11px] text-zinc-500">Misfire Policy</span>
                  <p className="font-mono text-zinc-200 mt-0.5">{routine.misfirePolicy}</p>
                </div>
              </div>

              {/* Next & Last Run */}
              <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-2.5 flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5 text-zinc-400">
                  <Clock className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Next: {routine.nextRunAt && routine.enabled ? formatRelativeTime(routine.nextRunAt) : "None"}</span>
                </div>
                <div className="text-zinc-500">
                  Last: {routine.lastRunAt ? formatRelativeTime(routine.lastRunAt) : "Never"}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Routine Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-sm font-semibold text-zinc-100">
                Create Recurring Routine / تعریف روال زمان‌بندی‌شده
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 p-1 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-zinc-300">Name / عنوان</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Daily Queue Sweeper"
                  className="w-full mt-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-300">Description / توضیحات</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description of routine purpose"
                  className="w-full mt-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-zinc-300">Schedule Type / نوع زمان‌بندی</label>
                  <select
                    value={scheduleType}
                    onChange={(e) => setScheduleType(e.target.value as any)}
                    className="w-full mt-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-hidden"
                  >
                    <option value="cron">Cron Expression</option>
                    <option value="interval">Interval (e.g. every:60s)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium text-zinc-300">Timezone / منطقه زمانی</label>
                  <input
                    type="text"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    placeholder="UTC, America/New_York, Asia/Tehran"
                    className="w-full mt-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-zinc-300">
                    Schedule Expression / عبارت زمان‌بندی
                  </label>
                  <button
                    type="button"
                    onClick={handlePreview}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 cursor-pointer font-medium"
                  >
                    Preview Next Runs / پیش‌نمایش
                  </button>
                </div>
                <input
                  type="text"
                  required
                  value={scheduleExpr}
                  onChange={(e) => setScheduleExpr(e.target.value)}
                  placeholder={scheduleType === "cron" ? "0 9 * * 1-5" : "every:300s"}
                  className="w-full mt-1 font-mono rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-hidden"
                />
              </div>

              {/* Next run previews */}
              {previewRuns.length > 0 && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-1">
                  <span className="text-[10px] uppercase font-semibold text-zinc-500">Upcoming Triggers:</span>
                  {previewRuns.map((run, i) => (
                    <div key={i} className="text-xs font-mono text-zinc-300 flex items-center gap-2">
                      <span className="text-zinc-600">#{i + 1}</span>
                      <span>{new Date(run).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-zinc-300">Target Type / نوع مقصد</label>
                  <select
                    value={targetType}
                    onChange={(e) => setTargetType(e.target.value as any)}
                    className="w-full mt-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-hidden"
                  >
                    <option value="workflow">Workflow</option>
                    <option value="agent">Agent</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium text-zinc-300">Target ID / شناسه مقصد</label>
                  <input
                    type="text"
                    required
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    placeholder="Workflow or Agent ID"
                    className="w-full mt-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-300">Misfire Policy / رفتار در عقب‌افتادگی</label>
                <select
                  value={misfirePolicy}
                  onChange={(e) => setMisfirePolicy(e.target.value as any)}
                  className="w-full mt-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-hidden"
                >
                  <option value="skip">Skip (رد کردن اجراهای از دست‌رفته)</option>
                  <option value="coalesce">Coalesce (تجمیع در یک اجرا)</option>
                  <option value="enqueue">Enqueue (اجرای تمام موارد جامانده)</option>
                </select>
              </div>

              {formError && <p className="text-xs text-red-400">{formError}</p>}

              <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setModalOpen(false)}
                  className="text-xs border-zinc-800 hover:bg-zinc-900 cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={creating}
                  className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer"
                >
                  {creating ? "Creating..." : "Save Routine"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Execution History Modal */}
      {historyRoutine && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-6 space-y-4 shadow-2xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">
                  Execution History: {historyRoutine.name}
                </h3>
                <p className="text-xs text-zinc-400">Past trigger executions and audit log</p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryRoutine(null)}
                className="text-zinc-500 hover:text-zinc-300 p-1 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {historyLoading ? (
              <p className="text-xs text-zinc-500 py-4 text-center">Loading history...</p>
            ) : historyItems.length === 0 ? (
              <p className="text-xs text-zinc-500 py-4 text-center">No past executions recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {historyItems.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            item.status === "success"
                              ? "bg-emerald-400"
                              : item.status === "failed"
                              ? "bg-red-400"
                              : "bg-amber-400"
                          }`}
                        />
                        <span className="font-medium text-zinc-200 capitalize">{item.status}</span>
                        {item.runId && <span className="font-mono text-zinc-500 text-[11px]">Run: {item.runId}</span>}
                      </div>
                      {item.error && <p className="text-[11px] text-red-400 mt-0.5">{item.error}</p>}
                    </div>
                    <span className="text-[11px] text-zinc-500">
                      {formatRelativeTime(item.executedAt || item.scheduledAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
