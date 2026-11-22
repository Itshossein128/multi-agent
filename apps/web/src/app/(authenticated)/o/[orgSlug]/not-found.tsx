import Link from "next/link";
import { AlertCircle, ArrowLeft } from "lucide-react";

export default function OrganizationNotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-8 shadow-xl">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-400">
          <AlertCircle className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="space-y-1.5">
          <span className="inline-block rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-0.5 font-mono text-[11px] font-medium text-zinc-400">
            404
          </span>
          <h1 className="text-lg font-semibold text-zinc-100">Not found</h1>
          <p className="text-sm text-zinc-400">
            This organization page is unavailable or you do not have access.
          </p>
        </div>
        <div className="pt-2">
          <Link
            href="/"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 text-xs font-medium text-white transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
