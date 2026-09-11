"use client";

import React from "react";
import Link from "next/link";
import { Columns3, Layers, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { WorkflowEditor } from "@/components/workflow/WorkflowEditor";

export default function OrgPage() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* Header managed by layout */}

      {/* Editor fills the rest of the viewport */}
      <main className="flex min-h-0 flex-1 flex-col">
        <WorkflowEditor />
      </main>
    </div>
  );
}
