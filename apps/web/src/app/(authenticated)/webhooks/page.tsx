"use client";

import React, { useEffect, useState } from "react";
import {
  Webhook,
  Plus,
  Key,
  Trash2,
  Activity,
  AlertCircle,
  CheckCircle2,
  Copy,
  RefreshCw,
  X,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/formatRelativeTime";
import { useStudioLocale } from "@/lib/useStudioLocale";

interface WebhookTrigger {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  hasSecret: boolean;
  targetType: "workflow" | "agent";
  targetId: string;
  enabled: boolean;
  rateLimitPerMinute: number;
  createdAt: string;
}

interface WebhookDeliveryItem {
  id: string;
  deliveredAt: string;
  status: "accepted" | "rejected" | "failed";
  httpStatus: number;
  errorReason?: string | null;
  payloadSummary: Record<string, unknown>;
  durationMs: number;
}

const translations = {
  en: {
    title: "Inbound Webhook Triggers",
    subtitle: "Trigger workflows and agents via HMAC-SHA256 authenticated inbound HTTP webhooks.",
    refresh: "Refresh",
    createTrigger: "Create Webhook Trigger",
    loading: "Loading webhook triggers...",
    noTriggers: "No Webhook Triggers Configured",
    noTriggersDesc: "Create an authenticated webhook endpoint to trigger agent tasks or workflows from GitHub, Stripe, or CI/CD pipelines.",
    createFirst: "Create Your First Webhook Trigger",
    active: "Active",
    disabled: "Disabled",
    rotateTitle: "Rotate signing secret",
    deliveriesTitle: "View delivery log",
    deleteTitle: "Delete webhook trigger",
    inboundEndpoint: "Inbound Endpoint",
    target: "Target",
    rateLimit: "Rate Limit",
    reqPerMin: "req/min",
    confirmDelete: "Are you sure you want to delete this webhook trigger?",
    confirmRotate: "Rotating the secret will immediately invalidate existing webhook producers. Are you sure?",
    createModalTitle: "Create Webhook Trigger",
    nameLabel: "Name",
    namePlaceholder: "e.g. GitHub Pull Request Webhook",
    descLabel: "Description",
    descPlaceholder: "Optional description of webhook source and payload",
    targetTypeLabel: "Target Type",
    targetIdLabel: "Target ID",
    targetIdPlaceholder: "Workflow or Agent ID",
    rateLimitLabel: "Rate Limit (requests / min)",
    cancel: "Cancel",
    saveTrigger: "Save Webhook Trigger",
    creating: "Creating...",
    secretModalTitle: "Webhook Signing Secret:",
    secretWarning: "Please copy and store this secret safely. For security reasons, it will never be displayed again!",
    secretSaved: "I have saved this secret",
    deliveryHeading: "Delivery Log:",
    deliverySubtitle: "Inbound HTTP delivery audit history",
    loadingDeliveries: "Loading delivery logs...",
    noDeliveries: "No webhook deliveries received yet.",
    payloadKeys: "Payload keys:",
    loadError: "Failed to load webhook triggers",
    createError: "Failed to create webhook trigger",
    rotateError: "Failed to rotate secret",
    switchLang: "فارسی",
  },
  fa: {
    title: "محرک‌های وب‌هوک ورودی",
    subtitle: "فعال‌سازی گردش‌کارها و عوامل از طریق وب‌هوک‌های امن مبتنی بر امضای HMAC-SHA256.",
    refresh: "تازه‌سازی",
    createTrigger: "تعریف محرک وب‌هوک",
    loading: "در حال بارگذاری محرک‌های وب‌هوک...",
    noTriggers: "هیچ محرک وب‌هوکی تعریف نشده است",
    noTriggersDesc: "ایجاد نقطه پایانی امن برای فراخوانی وظایف عامل یا گردش‌کارها از گیت‌هاب، استرایپ یا خطوط CI/CD.",
    createFirst: "اولین محرک وب‌هوک خود را ایجاد کنید",
    active: "فعال",
    disabled: "غیرفعال",
    rotateTitle: "بازنشانی کلید امضا",
    deliveriesTitle: "مشاهده سوابق دریافت",
    deleteTitle: "حذف محرک وب‌هوک",
    inboundEndpoint: "نقطه پایانی ورودی",
    target: "مقصد",
    rateLimit: "سقف نرخ",
    reqPerMin: "درخواست در دقیقه",
    confirmDelete: "آیا از حذف این محرک وب‌هوک اطمینان دارید؟",
    confirmRotate: "با بازنشانی کلید، تولیدکنندگان فعلی دسترسی خود را از دست خواهند داد. آیا مطمئن هستید؟",
    createModalTitle: "تعریف محرک وب‌هوک",
    nameLabel: "عنوان",
    namePlaceholder: "مثلاً وب‌هوک پول ریکوئست گیت‌هاب",
    descLabel: "توضیحات",
    descPlaceholder: "توضیحات اختیاری درباره منبع وب‌هوک و محتوای آن",
    targetTypeLabel: "نوع مقصد",
    targetIdLabel: "شناسه مقصد",
    targetIdPlaceholder: "شناسه گردش‌کار یا عامل",
    rateLimitLabel: "سقف نرخ درخواست (در دقیقه)",
    cancel: "انصراف",
    saveTrigger: "ذخیره محرک وب‌هوک",
    creating: "در حال ایجاد...",
    secretModalTitle: "کلید امضای وب‌هوک:",
    secretWarning: "لطفاً این کلید امضا را در جای امن ذخیره کنید؛ این کلید دیگر نمایش داده نخواهد شد!",
    secretSaved: "کلید را ذخیره کردم",
    deliveryHeading: "سوابق دریافت:",
    deliverySubtitle: "سابقه ممیزی درخواست‌های ورودی HTTP",
    loadingDeliveries: "در حال بارگذاری گزارش‌ها...",
    noDeliveries: "هنوز درخواستی دریافت نشده است.",
    payloadKeys: "کلیدهای داده:",
    loadError: "خطا در بارگذاری محرک‌های وب‌هوک",
    createError: "خطا در ایجاد محرک وب‌هوک",
    rotateError: "خطا در بازنشانی کلید امضا",
    switchLang: "English",
  },
};

export default function WebhookTriggersPage() {
  const { locale, direction, toggleLocale } = useStudioLocale();
  const t = translations[locale];

  const [triggers, setTriggers] = useState<WebhookTrigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetType, setTargetType] = useState<"workflow" | "agent">("workflow");
  const [targetId, setTargetId] = useState("");
  const [rateLimit, setRateLimit] = useState(60);
  const [formError, setFormError] = useState<string | null>(null);

  // Secret reveal modal
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [revealedTriggerName, setRevealedTriggerName] = useState<string>("");
  const [copied, setCopied] = useState(false);

  // Deliveries modal
  const [activeTrigger, setActiveTrigger] = useState<WebhookTrigger | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryItem[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);

  const fetchTriggers = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/execution/studio/webhooks/triggers");
      if (!res.ok) throw new Error(t.loadError);
      const data = await res.json();
      setTriggers(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err?.message || t.loadError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTriggers();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !targetId.trim()) return;

    try {
      setCreating(true);
      setFormError(null);
      const res = await fetch("/api/execution/studio/webhooks/triggers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          targetType,
          targetId: targetId.trim(),
          rateLimitPerMinute: Number(rateLimit) || 60,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t.createError);
      }

      const data = await res.json();
      setModalOpen(false);
      setName("");
      setDescription("");
      setTargetId("");

      // Reveal generated secret once
      if (data.signingSecret) {
        setRevealedSecret(data.signingSecret);
        setRevealedTriggerName(data.trigger?.name || "Webhook");
      }

      await fetchTriggers();
    } catch (err: any) {
      setFormError(err?.message || t.createError);
    } finally {
      setCreating(false);
    }
  };

  const handleRotateSecret = async (trigger: WebhookTrigger) => {
    if (!window.confirm(t.confirmRotate)) {
      return;
    }

    try {
      const res = await fetch(
        `/api/execution/studio/webhooks/triggers/${encodeURIComponent(trigger.id)}/rotate-secret`,
        {
          method: "POST",
        }
      );
      if (!res.ok) throw new Error(t.rotateError);
      const data = await res.json();
      if (data.signingSecret) {
        setRevealedSecret(data.signingSecret);
        setRevealedTriggerName(trigger.name);
      }
    } catch (err) {
      console.error("Failed to rotate secret:", err);
    }
  };

  const handleDelete = async (triggerId: string) => {
    if (!window.confirm(t.confirmDelete)) {
      return;
    }
    try {
      const res = await fetch(`/api/execution/studio/webhooks/triggers/${encodeURIComponent(triggerId)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setTriggers((prev) => prev.filter((t) => t.id !== triggerId));
      }
    } catch (err) {
      console.error("Failed to delete webhook trigger:", err);
    }
  };

  const openDeliveries = async (trigger: WebhookTrigger) => {
    setActiveTrigger(trigger);
    try {
      setDeliveriesLoading(true);
      const res = await fetch(
        `/api/execution/studio/webhooks/triggers/${encodeURIComponent(trigger.id)}/deliveries`
      );
      if (res.ok) {
        const data = await res.json();
        setDeliveries(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Failed to load deliveries:", err);
    } finally {
      setDeliveriesLoading(false);
    }
  };

  const copySecret = () => {
    if (revealedSecret) {
      navigator.clipboard.writeText(revealedSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div dir={direction} className="container mx-auto px-4 py-8 max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Webhook className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">{t.title}</h1>
              <p className="text-xs text-zinc-400">{t.subtitle}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={toggleLocale}
            className="gap-1.5 text-xs border-zinc-800 hover:bg-zinc-900 cursor-pointer"
          >
            <Globe className="h-3.5 w-3.5" />
            {t.switchLang}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={fetchTriggers}
            className="gap-1.5 text-xs border-zinc-800 hover:bg-zinc-900 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {t.refresh}
          </Button>

          <Button
            size="sm"
            onClick={() => {
              setModalOpen(true);
              setFormError(null);
            }}
            className="gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            {t.createTrigger}
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Triggers List */}
      {loading && triggers.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/20 p-8 text-center text-sm text-zinc-500">
          {t.loading}
        </div>
      ) : triggers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/10 p-12 text-center space-y-3">
          <Webhook className="h-8 w-8 text-zinc-600 mx-auto" />
          <h3 className="text-sm font-semibold text-zinc-300">{t.noTriggers}</h3>
          <p className="text-xs text-zinc-500 max-w-md mx-auto">{t.noTriggersDesc}</p>
          <Button
            size="sm"
            onClick={() => setModalOpen(true)}
            className="gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer mt-2"
          >
            <Plus className="h-3.5 w-3.5" />
            {t.createFirst}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {triggers.map((trigger) => (
            <div
              key={trigger.id}
              className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4 hover:border-zinc-700 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-zinc-100">{trigger.name}</h3>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                        trigger.enabled
                          ? "border-emerald-500/30 bg-emerald-950/30 text-emerald-400"
                          : "border-zinc-700 bg-zinc-800/40 text-zinc-400"
                      }`}
                    >
                      {trigger.enabled ? t.active : t.disabled}
                    </span>
                  </div>
                  {trigger.description && (
                    <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{trigger.description}</p>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRotateSecret(trigger)}
                    className="h-7 w-7 p-0 text-zinc-400 hover:text-amber-400 cursor-pointer"
                    title={t.rotateTitle}
                  >
                    <Key className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openDeliveries(trigger)}
                    className="h-7 w-7 p-0 text-zinc-400 hover:text-indigo-300 cursor-pointer"
                    title={t.deliveriesTitle}
                  >
                    <Activity className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(trigger.id)}
                    className="h-7 w-7 p-0 text-zinc-500 hover:text-red-400 cursor-pointer"
                    title={t.deleteTitle}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Endpoint URL */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                <span className="text-[10px] uppercase font-semibold text-zinc-500">{t.inboundEndpoint}</span>
                <p className="text-xs font-mono text-zinc-300 mt-0.5 select-all truncate" dir="ltr">
                  POST /api/webhooks/triggers/{trigger.id}
                </p>
              </div>

              {/* Details */}
              <div className="grid grid-cols-2 gap-2 text-xs border-t border-zinc-800/80 pt-3">
                <div>
                  <span className="text-[11px] text-zinc-500">{t.target} ({trigger.targetType})</span>
                  <p className="font-mono text-zinc-200 mt-0.5 truncate" dir="ltr">{trigger.targetId}</p>
                </div>
                <div>
                  <span className="text-[11px] text-zinc-500">{t.rateLimit}</span>
                  <p className="font-mono text-zinc-200 mt-0.5" dir="ltr">{trigger.rateLimitPerMinute} {t.reqPerMin}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Webhook Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-sm font-semibold text-zinc-100">{t.createModalTitle}</h3>
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
                <label className="text-xs font-medium text-zinc-300">{t.nameLabel}</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t.namePlaceholder}
                  className="w-full mt-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-300">{t.descLabel}</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t.descPlaceholder}
                  className="w-full mt-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-zinc-300">{t.targetTypeLabel}</label>
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
                  <label className="text-xs font-medium text-zinc-300">{t.targetIdLabel}</label>
                  <input
                    type="text"
                    required
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    placeholder={t.targetIdPlaceholder}
                    className="w-full mt-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-300">{t.rateLimitLabel}</label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={rateLimit}
                  onChange={(e) => setRateLimit(Number(e.target.value))}
                  className="w-full mt-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-hidden"
                />
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
                  {t.cancel}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={creating}
                  className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer"
                >
                  {creating ? t.creating : t.saveTrigger}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Secret Reveal Modal */}
      {revealedSecret && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2.5 text-amber-400">
              <Key className="h-5 w-5" />
              <h3 className="text-sm font-semibold text-zinc-100">
                {t.secretModalTitle} {revealedTriggerName}
              </h3>
            </div>

            <p className="text-xs text-zinc-300">{t.secretWarning}</p>

            <div className="relative">
              <input
                type="text"
                readOnly
                value={revealedSecret}
                className="w-full rounded-lg border border-amber-900/60 bg-amber-950/20 px-3 py-2 font-mono text-xs text-amber-200 select-all pr-10 focus:outline-hidden"
                dir="ltr"
              />
              <button
                type="button"
                onClick={copySecret}
                className="absolute right-2 top-2 text-zinc-400 hover:text-white p-1 cursor-pointer"
                title="Copy to clipboard"
              >
                {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="button"
                size="sm"
                onClick={() => setRevealedSecret(null)}
                className="text-xs bg-zinc-800 hover:bg-zinc-700 text-white cursor-pointer"
              >
                {t.secretSaved}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Deliveries Modal */}
      {activeTrigger && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-6 space-y-4 shadow-2xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">
                  {t.deliveryHeading} {activeTrigger.name}
                </h3>
                <p className="text-xs text-zinc-400">{t.deliverySubtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTrigger(null)}
                className="text-zinc-500 hover:text-zinc-300 p-1 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {deliveriesLoading ? (
              <p className="text-xs text-zinc-500 py-4 text-center">{t.loadingDeliveries}</p>
            ) : deliveries.length === 0 ? (
              <p className="text-xs text-zinc-500 py-4 text-center">{t.noDeliveries}</p>
            ) : (
              <div className="space-y-2">
                {deliveries.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-1 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium ${
                            item.status === "accepted"
                              ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/40"
                              : "bg-red-950/60 text-red-400 border border-red-800/40"
                          }`}
                        >
                          {item.httpStatus} {item.status.toUpperCase()}
                        </span>
                        <span className="text-[11px] text-zinc-400 font-mono" dir="ltr">{item.durationMs}ms</span>
                      </div>
                      <span className="text-[11px] text-zinc-500">
                        {formatRelativeTime(item.deliveredAt)}
                      </span>
                    </div>

                    {item.errorReason && (
                      <p className="text-[11px] text-red-400 font-mono">{item.errorReason}</p>
                    )}

                    {item.payloadSummary && Object.keys(item.payloadSummary).length > 0 && (
                      <div className="text-[10px] font-mono text-zinc-500 truncate" dir="ltr">
                        {t.payloadKeys} {JSON.stringify(item.payloadSummary)}
                      </div>
                    )}
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
