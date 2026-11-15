"use client";

import { scopedApiPath } from "@/lib/orgRoute";

import React, { useEffect, useId, useState } from "react";
import { Activity, Clock, CheckCircle2, AlertCircle, Save, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/formatRelativeTime";
import { useStudioLocale } from "@/lib/useStudioLocale";

interface HeartbeatData {
  agentId: string;
  tenantId?: string;
  enabled: boolean;
  intervalSeconds: number;
  lastHeartbeatAt?: string | null;
  nextHeartbeatAt?: string | null;
}

const translations = {
  en: {
    title: "Agent Heartbeat & Auto-Wakeup",
    subtitle: "Periodically check in and wake this agent even if no manual tasks are assigned.",
    active: "Active",
    disabled: "Disabled",
    enableLabel: "Enable periodic heartbeat wakeup for this agent",
    intervalLabel: "Heartbeat Interval (seconds):",
    intervalHelp: "Minimum 30 seconds, default 300 seconds (5 minutes).",
    lastHeartbeat: "Last Heartbeat",
    nextScheduled: "Next Scheduled",
    never: "Never",
    notScheduled: "Not scheduled",
    loading: "Loading heartbeat settings...",
    loadError: "Failed to load heartbeat settings",
    saveError: "Failed to save heartbeat settings",
    saveSuccess: "Heartbeat settings saved successfully",
    saveButton: "Save Heartbeat Settings",
    saving: "Saving...",
    switchLang: "فارسی",
  },
  fa: {
    title: "ضربان و بیداری خودکار عامل",
    subtitle: "بررسی دوره‌ای و فعال‌سازی خودکار این عامل حتی در صورت عدم انتساب دستی وظایف.",
    active: "فعال",
    disabled: "غیرفعال",
    enableLabel: "فعال‌سازی بیداری متناوب برای این عامل",
    intervalLabel: "فاصله زمانی ضربان (ثانیه):",
    intervalHelp: "حداقل ۳۰ ثانیه، پیش‌فرض ۳۰۰ ثانیه (۵ دقیقه).",
    lastHeartbeat: "آخرین ضربان",
    nextScheduled: "اجرای بعدی",
    never: "هرگز",
    notScheduled: "برنامه‌ریزی نشده",
    loading: "در حال بارگذاری تنظیمات ضربان...",
    loadError: "خطا در دریافت تنظیمات ضربان",
    saveError: "خطا در ذخیره تنظیمات ضربان",
    saveSuccess: "تنظیمات ضربان با موفقیت ذخیره شد",
    saveButton: "ذخیره تنظیمات ضربان",
    saving: "در حال ذخیره...",
    switchLang: "English",
  },
};

export function AgentHeartbeatPanel({ agentId }: { agentId: string }) {
  const { locale, direction, toggleLocale } = useStudioLocale();
  const t = translations[locale];
  const enabledId = useId();
  const intervalId = useId();

  const [data, setData] = useState<HeartbeatData | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [intervalSeconds, setIntervalSeconds] = useState(300);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function fetchHeartbeat() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(
          scopedApiPath(`/api/execution/studio/agents/${encodeURIComponent(agentId)}/heartbeat`),
        );
        if (!res.ok) throw new Error(t.loadError);
        const json: HeartbeatData = await res.json();
        if (mounted) {
          setData(json);
          setEnabled(Boolean(json.enabled));
          setIntervalSeconds(json.intervalSeconds || 300);
        }
      } catch (err: unknown) {
        if (mounted) setError(err instanceof Error ? err.message : t.loadError);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void fetchHeartbeat();
    return () => {
      mounted = false;
    };
  }, [agentId, t.loadError]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      const res = await fetch(
        scopedApiPath(`/api/execution/studio/agents/${encodeURIComponent(agentId)}/heartbeat`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enabled,
            intervalSeconds: Number(intervalSeconds) || 300,
          }),
        },
      );
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error((errJson as { error?: string }).error || t.saveError);
      }
      const updated: HeartbeatData = await res.json();
      setData(updated);
      setSuccess(t.saveSuccess);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.saveError);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div
        role="status"
        className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 text-sm text-zinc-400"
      >
        {t.loading}
      </div>
    );
  }

  return (
    <div
      dir={direction}
      className="space-y-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800 pb-4">
        <div className="flex items-start gap-2.5">
          <Activity className="mt-0.5 h-5 w-5 shrink-0 text-indigo-400" aria-hidden="true" />
          <div>
            <h2 className="text-base font-semibold text-zinc-100">{t.title}</h2>
            <p className="text-xs text-zinc-400">{t.subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={toggleLocale}
            className="inline-flex min-h-7 cursor-pointer items-center gap-1.5 rounded-md border border-zinc-700/60 bg-zinc-800/80 px-2.5 py-1 font-mono text-xs text-zinc-300 hover:text-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            title="Toggle English / Persian"
          >
            <Globe className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t.switchLang}</span>
          </button>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
              enabled
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 [html[data-appearance='light']_&]:text-emerald-700"
                : "border-zinc-700 bg-zinc-800/40 text-zinc-400"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                enabled ? "animate-pulse bg-emerald-400" : "bg-zinc-500"
              }`}
              aria-hidden="true"
            />
            {enabled ? t.active : t.disabled}
          </span>
        </div>
      </div>

      <form onSubmit={(e) => void handleSave(e)} className="space-y-5">
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id={enabledId}
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 accent-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500"
          />
          <label htmlFor={enabledId} className="cursor-pointer text-xs font-medium text-zinc-200">
            {t.enableLabel}
          </label>
        </div>

        <div className="max-w-xs space-y-1.5">
          <label htmlFor={intervalId} className="block text-xs font-medium text-zinc-300">
            {t.intervalLabel}
          </label>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
            <input
              id={intervalId}
              type="number"
              min={30}
              max={86400}
              step={10}
              value={intervalSeconds}
              onChange={(e) => setIntervalSeconds(Number(e.target.value))}
              disabled={!enabled}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
            />
          </div>
          <p className="text-xs text-zinc-500">{t.intervalHelp}</p>
        </div>

        <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <span className="text-[11px] font-semibold uppercase text-zinc-500">
              {t.lastHeartbeat}
            </span>
            <p className="mt-1 font-mono text-xs text-zinc-200">
              {data?.lastHeartbeatAt ? formatRelativeTime(data.lastHeartbeatAt) : t.never}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <span className="text-[11px] font-semibold uppercase text-zinc-500">
              {t.nextScheduled}
            </span>
            <p className="mt-1 font-mono text-xs text-zinc-200">
              {data?.nextHeartbeatAt && enabled
                ? formatRelativeTime(data.nextHeartbeatAt)
                : t.notScheduled}
            </p>
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300 [html[data-appearance='light']_&]:text-red-700"
          >
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        {success ? (
          <div
            role="status"
            className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300 [html[data-appearance='light']_&]:text-emerald-700"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{success}</span>
          </div>
        ) : null}

        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            size="sm"
            disabled={saving}
            className="cursor-pointer gap-1.5 bg-indigo-600 text-xs text-white hover:bg-indigo-500"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            {saving ? t.saving : t.saveButton}
          </Button>
        </div>
      </form>
    </div>
  );
}
