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
    <div>
      <label className="flex flex-col gap-1.5 text-xs text-zinc-400">
        <span className="font-medium uppercase tracking-wider text-zinc-500">Organization</span>
        <select
          aria-label="Switch organization"
          className="w-full min-w-0 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          value={org.slug}
          onChange={(event) => void onChange(event.target.value)}
        >
          {organizations.map((item) => (
            <option key={item.id} value={item.slug}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <Link
        className="mt-2 inline-flex items-center rounded py-1 text-xs text-indigo-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        href="/invitations"
      >
        Invitations
      </Link>
    </div>
  );
}
