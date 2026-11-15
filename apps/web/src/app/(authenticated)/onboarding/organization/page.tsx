"use client";
import Link from "next/link";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
      <div className="space-y-2">
        <Link className="text-sm text-indigo-400" href="/invitations">View organization invitations</Link>
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

        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
          <input
            type="checkbox"
            checked={allowMemberInvites}
            onChange={(e) => setAllowMemberInvites(e.target.checked)}
            className="h-3.5 w-3.5 accent-indigo-500"
          />
          Allow members to invite others
        </label>

        {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
        <Button type="submit" disabled={busy || !name.trim()} className="w-full">
          {busy ? "Creating…" : "Create organization"}
        </Button>
      </form>
    </div>
  );
}
