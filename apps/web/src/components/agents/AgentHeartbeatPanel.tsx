"use client";

import React, { useEffect, useState } from "react";
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
        const res = await fetch(`/api/execution/studio/agents/${encodeURIComponent(agentId)}/heartbeat`);
        if (!res.ok) throw new Error(t.loadError);
        const json: HeartbeatData = await res.json();
        if (mounted) {
          setData(json);
          setEnabled(Boolean(json.enabled));
          setIntervalSeconds(json.intervalSeconds || 300);
        }
      } catch (err: any) {
        if (mounted) setError(err?.message || t.loadError);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    fetchHeartbeat();
    return () => {
      mounted = false;
    };
  }, [agentId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      const res = await fetch(`/api/execution/studio/agents/${encodeURIComponent(agentId)}/heartbeat`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          intervalSeconds: Number(intervalSeconds) || 300,
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || t.saveError);
      }
      const updated: HeartbeatData = await res.json();
      setData(updated);
      setSuccess(t.saveSuccess);
    } catch (err: any) {
      setError(err?.message || t.saveError);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 text-sm text-zinc-400">
        {t.loading}
      </div>
    );
  }

  return (
    <div
      dir={direction}
      className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 space-y-6"
    >
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-2.5">
          <Activity className="h-5 w-5 text-indigo-400" />
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              {t.title}
            </h3>
            <p className="text-xs text-zinc-400">
              {t.subtitle}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleLocale}
            className="inline-flex items-center gap-1 text-[11px] font-mono text-zinc-400 hover:text-indigo-300 bg-zinc-800/80 px-2 py-0.5 rounded border border-zinc-700/60 cursor-pointer"
            title="Toggle English / Persian"
          >
            <Globe className="h-3 w-3" />
            <span>{t.switchLang}</span>
          </button>
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
              enabled
                ? "border-emerald-500/30 bg-emerald-950/30 text-emerald-400"
                : "border-zinc-700 bg-zinc-800/40 text-zinc-400"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                enabled ? "bg-emerald-400 animate-pulse" : "bg-zinc-500"
              }`}
            />
            {enabled ? t.active : t.disabled}
          </span>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="heartbeatEnabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-indigo-600 focus:ring-indigo-500"
          />
          <label htmlFor="heartbeatEnabled" className="text-xs font-medium text-zinc-200 cursor-pointer">
            {t.enableLabel}
          </label>
        </div>

        <div className="space-y-1.5 max-w-xs">
          <label className="text-xs font-medium text-zinc-300">
            {t.intervalLabel}
          </label>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-zinc-500" />
            <input
              type="number"
              min={30}
              max={86400}
              step={10}
              value={intervalSeconds}
              onChange={(e) => setIntervalSeconds(Number(e.target.value))}
              disabled={!enabled}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-hidden disabled:opacity-50"
            />
          </div>
          <p className="text-[11px] text-zinc-500">
            {t.intervalHelp}
          </p>
        </div>

        {/* Timestamps status */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <span className="text-[11px] text-zinc-500 uppercase font-semibold">{t.lastHeartbeat}</span>
            <p className="text-xs font-mono text-zinc-200 mt-1">
              {data?.lastHeartbeatAt ? formatRelativeTime(data.lastHeartbeatAt) : t.never}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <span className="text-[11px] text-zinc-500 uppercase font-semibold">{t.nextScheduled}</span>
            <p className="text-xs font-mono text-zinc-200 mt-1">
              {data?.nextHeartbeatAt && enabled
                ? formatRelativeTime(data.nextHeartbeatAt)
                : t.notScheduled}
            </p>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-300">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            size="sm"
            disabled={saving}
            className="gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? t.saving : t.saveButton}
          </Button>
        </div>
      </form>
    </div>
  );
}
