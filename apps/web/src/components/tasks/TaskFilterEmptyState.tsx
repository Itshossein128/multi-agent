"use client";

import React from "react";
import { FilterX, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface TaskFilterEmptyStateProps {
  onResetFilters: () => void;
}

export function TaskFilterEmptyState({ onResetFilters }: TaskFilterEmptyStateProps) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex w-full max-w-md flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-12 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800/80 text-zinc-400">
          <FilterX className="h-6 w-6 text-zinc-400" />
        </div>
        <h3 className="text-sm font-semibold text-zinc-200">No matching tasks</h3>
        <p className="mt-1 text-xs text-zinc-400">
          No tasks match your currently selected filters. Adjust your criteria or clear all filters to view tasks.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={onResetFilters}
          className="mt-4 gap-1.5 border-zinc-700 bg-zinc-800/80 text-xs text-zinc-200 hover:bg-zinc-700 hover:text-zinc-100 cursor-pointer"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Clear all filters
        </Button>
      </div>
    </div>
  );
}
