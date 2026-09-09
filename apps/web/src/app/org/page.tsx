"use client";

import React from "react";
import Link from "next/link";
import { Columns3, Layers, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { WorkflowEditor } from "@/components/workflow/WorkflowEditor";

export default function OrgPage() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 flex h-16 flex-shrink-0 items-center justify-between border-b border-zinc-800/80 bg-zinc-950/80 px-4 backdrop-blur-md lg:px-8">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            title="Back to Dashboard"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-md shadow-indigo-500/20 hover:opacity-90"
          >
            <Layers className="h-5 w-5 text-white" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold tracking-tight text-white">ORG</span>
              <Badge
                variant="outline"
                className="border-indigo-500/30 bg-indigo-950/30 text-[10px] text-indigo-300"
              >
                Visual Programming
              </Badge>
            </div>
            <p className="text-[11px] text-zinc-400">
              Design multi-agent workflows as graphs — compiled to LangGraph on execution
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/runs"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-800 bg-transparent px-3 text-xs font-medium text-zinc-300 shadow-sm transition-colors hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer"
          >
            Run history
          </Link>
          <Link
            href="/tasks"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-800 bg-transparent px-3 text-xs font-medium text-zinc-300 shadow-sm transition-colors hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer"
          >
            <Columns3 className="h-3.5 w-3.5" />
            Task Board
          </Link>
          <span className="hidden items-center gap-1.5 text-[11px] text-zinc-500 sm:flex">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            Workflow definitions compile to LangGraph StateGraph
          </span>
        </div>
      </header>

      {/* Editor fills the rest of the viewport */}
      <main className="flex min-h-0 flex-1 flex-col">
        <WorkflowEditor />
      </main>
    </div>
  );
}
