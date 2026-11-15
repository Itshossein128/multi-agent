"use client";

import React from "react";
import { WorkflowEditor } from "@/components/workflow/WorkflowEditor";

export default function OrgPage() {
  return (
    <div className="studio-editor flex min-h-[calc(100dvh-4rem-1px)] flex-1 flex-col bg-zinc-950 text-zinc-100 lg:h-[calc(100dvh-4rem-1px)] lg:overflow-hidden">
      <WorkflowEditor />
    </div>
  );
}
