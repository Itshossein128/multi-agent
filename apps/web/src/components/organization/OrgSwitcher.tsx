"use client";

import Link from "next/link";
import React from "react";
import { useSession } from "next-auth/react";
import { useOrg } from "@/components/organization/OrgProvider";
import { orgPath } from "@/lib/orgRoute";

export function OrgSwitcher() {
  const { org, organizations } = useOrg();
  const { update } = useSession();

  async function onChange(nextSlug: string) {
    if (!nextSlug || nextSlug === org.slug) return;
    const selected = organizations.find((item) => item.slug === nextSlug);
    if (!selected) return;
    try {
      await fetch("/api/organizations/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: nextSlug }),
      });
      await update?.({ tenantId: selected.id });
    } catch {
      /* still navigate; layout will re-check membership */
    }
    // A document navigation discards queries, editor state, streams and pending requests.
    window.location.assign(orgPath(nextSlug, "/projects"));
  }

  return (
    <div><label className="flex items-center gap-2 text-xs text-zinc-400">
      <span className="shrink-0 font-medium uppercase tracking-wider text-zinc-500">Organization</span>
      <select
        aria-label="Switch organization"
        className="max-w-xs rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
        value={org.slug}
        onChange={(event) => void onChange(event.target.value)}
      >
        {organizations.map((item) => (
          <option key={item.id} value={item.slug}>
            {item.name}
          </option>
        ))}
      </select>
    </label><Link className="mt-2 block text-xs text-indigo-400" href="/invitations">Invitations</Link></div>
  );
}
