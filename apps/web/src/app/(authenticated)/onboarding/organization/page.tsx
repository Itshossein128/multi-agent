"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const NAME_MAX = 120;
const DRAFT_KEY = "studio.org.wizard.draft";

type Draft = {
  name: string;
  description: string;
  defaultTimezone: string;
  allowMemberInvites: boolean;
};

const DEFAULT_CONFIG = {
  defaultTimezone: "UTC",
  allowMemberInvites: true,
};

function loadDraft(): Draft {
  if (typeof window === "undefined") {
    return { name: "", description: "", ...DEFAULT_CONFIG };
  }
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return { name: "", description: "", ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<Draft>;
    return {
      name: typeof parsed.name === "string" ? parsed.name : "",
      description: typeof parsed.description === "string" ? parsed.description : "",
      defaultTimezone:
        typeof parsed.defaultTimezone === "string" && parsed.defaultTimezone.trim()
          ? parsed.defaultTimezone
          : DEFAULT_CONFIG.defaultTimezone,
      allowMemberInvites:
        typeof parsed.allowMemberInvites === "boolean"
          ? parsed.allowMemberInvites
          : DEFAULT_CONFIG.allowMemberInvites,
    };
  } catch {
    return { name: "", description: "", ...DEFAULT_CONFIG };
  }
}

export default function OrganizationOnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [defaultTimezone, setDefaultTimezone] = useState(DEFAULT_CONFIG.defaultTimezone);
  const [allowMemberInvites, setAllowMemberInvites] = useState(DEFAULT_CONFIG.allowMemberInvites);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const draft = loadDraft();
    setName(draft.name);
    setDescription(draft.description);
    setDefaultTimezone(draft.defaultTimezone);
    setAllowMemberInvites(draft.allowMemberInvites);
    void (async () => {
      try {
        const res = await fetch("/api/organizations/current");
        if (res.ok) {
          router.replace("/projects");
          return;
        }
      } finally {
        setChecking(false);
      }
    })();
  }, [router]);

  useEffect(() => {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ name, description, defaultTimezone, allowMemberInvites }),
    );
  }, [name, description, defaultTimezone, allowMemberInvites]);

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
            defaultTimezone: defaultTimezone.trim() || DEFAULT_CONFIG.defaultTimezone,
            allowMemberInvites,
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not create organization");
      sessionStorage.removeItem(DRAFT_KEY);
      router.replace("/projects");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create organization");
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-16 text-sm text-zinc-400">
        Checking organization setup…
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-lg px-4 py-12 space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-white">Set up your organization</h1>
        <p className="text-sm text-zinc-400">
          Create your organization to start projects, workspaces, and tasks. You can refine settings later.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
        <label className="block space-y-1 text-xs text-zinc-400">
          Organization name <span className="text-red-300">*</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            placeholder="Acme Studio"
            autoFocus
          />
        </label>
        <label className="block space-y-1 text-xs text-zinc-400">
          Description (optional)
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            placeholder="What this organization is for"
          />
        </label>

        <fieldset className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Optional configuration
          </legend>
          <label className="block space-y-1 text-xs text-zinc-400">
            Default timezone
            <input
              value={defaultTimezone}
              onChange={(e) => setDefaultTimezone(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              placeholder="UTC"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={allowMemberInvites}
              onChange={(e) => setAllowMemberInvites(e.target.checked)}
              className="h-3.5 w-3.5 accent-indigo-500"
            />
            Allow members to invite others
          </label>
        </fieldset>

        {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
        <Button type="submit" disabled={busy || !name.trim()} className="w-full">
          {busy ? "Creating…" : "Create organization"}
        </Button>
      </form>
    </div>
  );
}
