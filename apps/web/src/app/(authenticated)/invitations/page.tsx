"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Invitation = { organizationId: string; role: string; organization: { name: string; slug: string } };
export default function Invitations() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { void fetch("/api/invitations", { cache: "no-store" }).then(async r => { if (!r.ok) throw new Error("Sign in to view invitations."); setInvitations(await r.json()); }).catch(e => setError(e.message)); }, []);
  async function accept(invitation: Invitation) {
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/invitations/${encodeURIComponent(invitation.organizationId)}/accept`, { method: "POST" });
      if (!r.ok) throw new Error((await r.json()).error ?? "Could not accept invitation.");
      // A document navigation clears any previously selected organization state.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/o/${encodeURIComponent(invitation.organization.slug)}/projects`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not accept invitation."); setBusy(false); }
  }
  return <main className="mx-auto max-w-2xl space-y-5 p-8"><h1 className="text-2xl font-semibold">Organization invitations</h1>{error && <p role="alert">{error}</p>}{invitations.map(i => <div className="flex items-center justify-between rounded-lg border border-zinc-800 p-4" key={i.organizationId}><div><p>{i.organization.name}</p><p className="text-sm text-zinc-400">Role: {i.role}</p></div><Button disabled={busy} onClick={() => void accept(i)}>Accept invitation</Button></div>)}{!invitations.length && !error && <p>No pending invitations.</p>}<Link className="text-indigo-400" href="/">Back to organizations</Link></main>;
}
