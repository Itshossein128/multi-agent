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
  const deletionEnabled = process.env.NEXT_PUBLIC_ORG_DELETION_ENABLED !== "false";
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleteStatus, setDeleteStatus] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const [profileName, setProfileName] = useState(org.name);
  const [profileSlug, setProfileSlug] = useState(org.slug);
  const [profileError, setProfileError] = useState("");
  const [profileSuccess, setProfileSuccess] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);

  async function handleUpdateProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileBusy(true);
    setProfileError("");
    setProfileSuccess("");
    try {
      const response = await fetch("/api/organizations/current", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: profileName, slug: profileSlug }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Failed to update profile.");
      if (result.slug && result.slug !== org.slug) {
        setProfileSuccess("Organization renamed. Redirecting to new address...");
        setTimeout(() => {
          window.location.href = `/o/${encodeURIComponent(result.slug)}/settings`;
        }, 500);
      } else {
        setProfileSuccess("Organization profile updated successfully.");
      }
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Failed to update profile.");
    } finally {
      setProfileBusy(false);
    }
  }

  async function handleDeleteOrg(e: React.FormEvent) {
    e.preventDefault();
    if (deleteConfirmName !== org.name) {
      setDeleteError(`Please type the exact organization name: "${org.name}"`);
      return;
    }
    setDeleting(true);
    setDeleteError("");
    setDeleteStatus("Purging organization data...");
    try {
      const response = await fetch(
        `/api/o/${encodeURIComponent(org.slug)}/execution/studio/organizations/current`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmationName: deleteConfirmName }),
        }
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Failed to delete organization.");
      }
      setDeleteStatus("Organization deleted successfully. Redirecting...");
      setTimeout(() => {
        window.location.href = "/";
      }, 500);
    } catch (err) {
      setDeleteStatus(null);
      setDeleteError(err instanceof Error ? err.message : "Deletion failed.");
    } finally {
      setDeleting(false);
    }
  }

  return <main className="mx-auto w-full max-w-5xl space-y-6 p-6">
    <div><h1 className="text-2xl font-semibold">Organization settings</h1><p className="mt-2 text-sm text-zinc-400">Manage {org.name}. Your role: {org.role}.</p></div>
    {(error || loadError) && <p role="alert" className="text-sm text-red-400">{error || loadError?.message}</p>}

    {canManage && (
      <section className="rounded-lg border border-zinc-800 p-4 space-y-4">
        <h2 className="text-lg font-medium">Organization profile</h2>
        {profileError && <p role="alert" className="text-sm text-red-400">{profileError}</p>}
        {profileSuccess && <p role="status" className="text-sm text-emerald-400">{profileSuccess}</p>}
        <form onSubmit={handleUpdateProfile} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm">
              Organization name
              <input
                className="block w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-100"
                type="text"
                required
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
              />
            </label>
            <label className="space-y-2 text-sm">
              Organization slug
              <input
                className="block w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-100"
                type="text"
                required
                value={profileSlug}
                onChange={(e) => setProfileSlug(e.target.value.toLowerCase())}
              />
            </label>
          </div>
          <p className="text-xs text-zinc-400">
            The slug is used in organization URLs (e.g. <code>/o/{profileSlug}/...</code>). If changed, existing bookmarks or links using the previous slug will return 404 without redirects.
          </p>
          <Button disabled={profileBusy} type="submit">Save changes</Button>
        </form>
      </section>
    )}

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

    {deletionEnabled && org.role === "owner" && (
      <div className="rounded-lg border border-red-900/50 bg-red-950/10 p-4 space-y-3">
        <h2 className="text-lg font-medium text-red-400">Danger Zone</h2>
        <p className="text-sm text-zinc-400">
          Permanently delete <strong>{org.name}</strong> and all associated projects, tasks,
          runs, memories, and secrets. This action cannot be undone.
        </p>
        {deleteError && <p role="alert" className="text-sm text-red-400">{deleteError}</p>}
        {deleteStatus && <p role="status" className="text-sm text-zinc-300">{deleteStatus}</p>}
        <form onSubmit={handleDeleteOrg} className="space-y-3">
          <label className="block text-sm text-zinc-300">
            Type <span className="font-semibold text-zinc-100">{org.name}</span> to confirm:
            <input
              type="text"
              aria-label="Confirm organization name"
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              disabled={deleting}
              className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-100"
              placeholder={org.name}
              required
            />
          </label>
          <Button
            type="submit"
            variant="destructive"
            disabled={deleting || deleteConfirmName !== org.name}
          >
            {deleting ? "Deleting organization..." : "Delete this organization"}
          </Button>
        </form>
      </div>
    )}
  </main>;
}
