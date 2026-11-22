"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, Building2, Check, Layers, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

type Invitation = {
  organizationId: string;
  role: string;
  organization: { name: string; slug: string };
};

export default function Invitations() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/invitations", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error("Sign in to view invitations.");
        setInvitations(await r.json());
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function accept(invitation: Invitation) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        `/api/invitations/${encodeURIComponent(invitation.organizationId)}/accept`,
        { method: "POST" },
      );
      if (!r.ok) throw new Error((await r.json()).error ?? "Could not accept invitation.");
      // A document navigation clears any previously selected organization state.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/o/${encodeURIComponent(invitation.organization.slug)}/projects`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not accept invitation.");
      setBusy(false);
    }
  }

  return (
    <main className="appearance-locked min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-12 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-indigo-400">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600">
              <Layers className="h-4 w-4 text-white" aria-hidden="true" />
            </div>
            <span>Agent Studio</span>
          </div>
          <Link
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-indigo-300 transition-colors hover:border-zinc-700 hover:bg-zinc-900 hover:underline"
            href="/"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Back to organizations</span>
          </Link>
        </div>

        <div className="flex items-center gap-3 border-b border-zinc-800 pb-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-400">
            <Mail className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-zinc-100">
              Organization invitations
            </h1>
            <p className="text-xs text-zinc-400">
              Review and accept pending invitations to collaborate in organization workspaces.
            </p>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-300"
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {loading && !error && (
          <div role="status" className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-400 animate-pulse">
            Loading invitations…
          </div>
        )}

        {!loading && invitations.length > 0 && (
          <div className="space-y-3">
            {invitations.map((i) => (
              <div
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:border-zinc-700"
                key={i.organizationId}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-indigo-400">
                    <Building2 className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">{i.organization.name}</p>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      Role: <span className="font-medium capitalize text-zinc-200">{i.role}</span> ·{" "}
                      <span className="font-mono text-zinc-500">/{i.organization.slug}</span>
                    </p>
                  </div>
                </div>
                <Button
                  disabled={busy}
                  onClick={() => void accept(i)}
                  className="gap-1.5 bg-indigo-600 text-xs text-white hover:bg-indigo-500 cursor-pointer"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Accept invitation
                </Button>
              </div>
            ))}
          </div>
        )}

        {!loading && !invitations.length && !error && (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 px-6 py-12 text-center space-y-2">
            <Mail className="mx-auto h-7 w-7 text-zinc-500" aria-hidden="true" />
            <p className="text-sm font-medium text-zinc-300">No pending invitations.</p>
            <p className="text-xs text-zinc-500">
              When an organization owner or admin invites your email address, it will appear here.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
