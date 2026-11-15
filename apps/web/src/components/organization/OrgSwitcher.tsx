"use client";

import Link from "next/link";
import React from "react";
import { useSession } from "next-auth/react";
import { Mail } from "lucide-react";
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
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-2.5">
      <label className="flex flex-col gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Organization
        </span>
        <select
          aria-label="Switch organization"
          className="studio-select h-8 w-full min-w-0 cursor-pointer rounded-lg border border-zinc-800 bg-zinc-950/80 px-2.5 text-xs font-medium text-zinc-100 transition-colors hover:border-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
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
        className="mt-2 flex min-h-8 items-center gap-2 rounded-lg px-2 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800/70 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        href="/invitations"
      >
        <Mail className="h-3.5 w-3.5 shrink-0 text-indigo-400" aria-hidden="true" />
        <span>Invitations</span>
      </Link>
    </div>
  );
}
