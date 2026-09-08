import type { ReactNode } from "react";

export const fieldClass = "w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-2 focus:outline-indigo-400 disabled:opacity-70";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1.5 text-sm text-zinc-300"><span>{label}</span>{children}</label>;
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5"><h2 className="text-base font-semibold text-zinc-100">{title}</h2>{children}</section>;
}
