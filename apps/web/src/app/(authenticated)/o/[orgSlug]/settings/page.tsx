"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "@/components/organization/OrgProvider";
import { Button } from "@/components/ui/button";
import type { OrganizationMembership } from "../../../../../../../../src/studio/contracts";

const roles = ["owner", "admin", "member", "viewer"] as const;
export default function OrganizationSettings() {
  const { org } = useOrg();
  const [email, setEmail] = useState(""); const [role, setRole] = useState("member");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const canManage = org.role === "owner" || org.role === "admin";
  const base = `/api/o/${encodeURIComponent(org.slug)}/execution/studio/organizations/current/members`;
  const { data: members = [], error: loadError, isPending, refetch } = useQuery<OrganizationMembership[]>({
    queryKey: ["organization-members", org.id],
    queryFn: async () => {
      const response = await fetch(base, { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 404 ? "Organization access is no longer available." : "Could not load members.");
      return response.json();
    },
  });
  async function change(path: string, method: string, body?: unknown) {
    setBusy(true); setError("");
    try {
      const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not update membership.");
      if (method === "POST") setEmail("");
      await refetch();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update membership."); }
    finally { setBusy(false); }
  }
  const ownerCount = members.filter(m => m.role === "owner" && m.status === "active").length;
  return <main className="mx-auto w-full max-w-5xl space-y-6 p-6">
    <div><h1 className="text-2xl font-semibold">Organization settings</h1><p className="mt-2 text-sm text-zinc-400">Manage membership in {org.name}. Your role: {org.role}.</p></div>
    {(error || loadError) && <p role="alert" className="text-sm text-red-400">{error || loadError?.message}</p>}
    {isPending && <p role="status">Loading members…</p>}
    {canManage && <form className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-800 p-4" onSubmit={e => { e.preventDefault(); void change(base, "POST", { email, role }); }}>
      <label className="flex-1 space-y-2 text-sm">Registered user email<input className="block w-full rounded border border-zinc-700 bg-zinc-950 p-2" type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label className="space-y-2 text-sm">Invitation role<select aria-label="Invitation role" className="block rounded border border-zinc-700 bg-zinc-950 p-2" value={role} onChange={e => setRole(e.target.value)}>{roles.filter(r => org.role === "owner" || r !== "owner").map(r => <option key={r}>{r}</option>)}</select></label>
      <Button disabled={busy} type="submit">Invite member</Button>
    </form>}
    <div className="overflow-x-auto rounded-lg border border-zinc-800"><table className="w-full text-left text-sm"><caption className="sr-only">Organization members</caption><thead><tr className="border-b border-zinc-800"><th className="p-3">User</th><th className="p-3">Role</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr></thead><tbody>
      {members.map(member => {
        const protectedOwner = member.role === "owner" && (org.role !== "owner" || (member.status === "active" && ownerCount <= 1));
        const editable = canManage && !protectedOwner && member.status !== "removed";
        const path = `${base}/${encodeURIComponent(member.userId)}`;
        return <tr key={member.userId} className="border-b border-zinc-800 last:border-0"><td className="p-3 font-mono text-xs">{member.userId}</td><td className="p-3">{editable ? <select aria-label={`Role for ${member.userId}`} disabled={busy} value={member.role} className="rounded border border-zinc-700 bg-zinc-950 p-2" onChange={e => void change(path, "PATCH", { role: e.target.value })}>{roles.filter(r => org.role === "owner" || r !== "owner").map(r => <option key={r}>{r}</option>)}</select> : member.role}</td><td className="p-3">{member.status}</td><td className="space-x-2 p-3">{editable && <>
          {member.status === "active" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void change(path, "PATCH", { status: "suspended" })}>Suspend</Button>}
          {member.status === "suspended" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void change(path, "PATCH", { status: "active" })}>Restore</Button>}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void change(path, "DELETE")}>Remove</Button>
        </>}{protectedOwner && <span className="text-xs text-zinc-500">Protected owner</span>}</td></tr>;
      })}
    </tbody></table></div>
  </main>;
}
