"use client";
import Link from "next/link";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Layers, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { orgPath } from "@/lib/orgRoute";

const NAME_MAX = 120;
const DRAFT_KEY = "studio.org.wizard.draft";

type Draft = {
  name: string;
  description: string;
  allowMemberInvites: boolean;
};

const DEFAULT_CONFIG = {
  defaultTimezone: "UTC",
  allowMemberInvites: true,
};

function loadDraft(): Draft {
  if (typeof window === "undefined") {
    return { name: "", description: "", allowMemberInvites: DEFAULT_CONFIG.allowMemberInvites };
  }
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return { name: "", description: "", allowMemberInvites: DEFAULT_CONFIG.allowMemberInvites };
    const parsed = JSON.parse(raw) as Partial<Draft>;
    return {
      name: typeof parsed.name === "string" ? parsed.name : "",
      description: typeof parsed.description === "string" ? parsed.description : "",
      allowMemberInvites:
        typeof parsed.allowMemberInvites === "boolean"
          ? parsed.allowMemberInvites
          : DEFAULT_CONFIG.allowMemberInvites,
    };
  } catch {
    return { name: "", description: "", allowMemberInvites: DEFAULT_CONFIG.allowMemberInvites };
  }
}

export default function OrganizationOnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [allowMemberInvites, setAllowMemberInvites] = useState(DEFAULT_CONFIG.allowMemberInvites);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const draft = loadDraft();
    setName(draft.name);
    setDescription(draft.description);
    setAllowMemberInvites(draft.allowMemberInvites);
    void (async () => {
      let leaving = false;
      try {
        const res = await fetch("/api/organizations/current");
        if (res.status === 401) {
          leaving = true;
          router.replace("/login?callbackUrl=%2Fonboarding%2Forganization");
          return;
        }
        if (res.ok) {
          leaving = true;
          const org = (await res.json().catch(() => ({}))) as { slug?: string };
          router.replace(org.slug ? orgPath(org.slug, "/projects") : "/");
          return;
        }
        if (res.status !== 404) {
          setUnavailable(true);
          setError("Unable to verify organization setup.");
        }
      } catch {
        setUnavailable(true);
        setError("Unable to verify organization setup.");
      } finally {
        if (!leaving) setChecking(false);
      }
    })();
  }, [router]);

  useEffect(() => {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ name, description, allowMemberInvites }),
    );
  }, [name, description, allowMemberInvites]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Organization name is required");
      return;
    }
    if (trimmed.length > NAME_MAX) {
      setError(`Name must be at most ${NAME_MAX} characters`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          description: description.trim(),
          config: {
            defaultTimezone: DEFAULT_CONFIG.defaultTimezone,
            allowMemberInvites,
          },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; slug?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not create organization");
      sessionStorage.removeItem(DRAFT_KEY);
      if (!body.slug) throw new Error("Organization created without slug");
      router.replace(orgPath(body.slug, "/projects"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create organization");
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-12 text-sm text-zinc-400 sm:px-6">
        Checking organization setup…
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-12 text-sm text-red-300 sm:px-6" role="alert">
        {error ?? "Unable to verify organization setup."}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-6 px-4 py-12 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-indigo-400">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600">
            <Layers className="h-4 w-4 text-white" aria-hidden="true" />
          </div>
          <span>Agent Studio</span>
        </div>
        <Link
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-indigo-300 transition-colors hover:border-zinc-700 hover:bg-zinc-900 hover:underline"
          href="/invitations"
        >
          <Mail className="h-3.5 w-3.5" aria-hidden="true" />
          <span>View organization invitations</span>
        </Link>
      </div>

      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-400">
          <Building2 className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-white">Set up your organization</h1>
          <p className="text-sm text-zinc-400">
            Create your organization to start projects, workspaces, and tasks. You can refine settings later.
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 shadow-xl">
        <label className="block space-y-1.5 text-xs font-medium text-zinc-300">
          <span className="flex items-center justify-between">
            <span>
              Organization name <span className="text-red-300">*</span>
            </span>
            <span className="font-mono text-[11px] font-normal text-zinc-500">
              {name.length}/{NAME_MAX}
            </span>
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX}
            className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            placeholder="Acme Studio"
            autoFocus
          />
        </label>
        <label className="block space-y-1.5 text-xs font-medium text-zinc-300">
          <span>Description (optional)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            placeholder="What this organization is for"
          />
        </label>

        <label className="flex items-center gap-2.5 text-xs font-medium text-zinc-300 cursor-pointer">
          <input
            type="checkbox"
            checked={allowMemberInvites}
            onChange={(e) => setAllowMemberInvites(e.target.checked)}
            className="h-4 w-4 accent-indigo-500"
          />
          Allow members to invite others
        </label>

        {error ? (
          <p role="alert" className="rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy || !name.trim()} className="w-full">
          {busy ? "Creating…" : "Create organization"}
        </Button>
      </form>
    </div>
  );
}
