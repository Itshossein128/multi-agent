"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Archive, ArrowUpRight, Check, Copy, FolderKanban, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/store/useToastStore";

export interface ProjectEntityRow {
  id: string;
  name: string;
  nameSource?: "manual" | "placeholder";
  description: string;
  status: string;
  updatedAt: string;
  createdAt?: string;
  usesDefaultWorkspace?: boolean;
}

interface ProjectCardProps {
  project: ProjectEntityRow;
  href: string;
  busy?: boolean;
  onEdit: (project: ProjectEntityRow) => void;
  onRetire: (project: ProjectEntityRow) => void;
}

function formatUpdatedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Semantic project summary card with stretched primary dashboard link and independent secondary actions. */
export function ProjectCard({
  project,
  href,
  busy = false,
  onEdit,
  onRetire,
}: ProjectCardProps) {
  const [copied, setCopied] = useState(false);
  const isRetired = project.status === "retired";
  const isPlaceholderName =
    project.nameSource === "placeholder" || project.name === "Untitled project";
  const updatedLabel = formatUpdatedDate(project.updatedAt);

  async function handleCopyId() {
    try {
      await navigator.clipboard.writeText(project.id);
      setCopied(true);
      toast("Project ID copied");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast("Unable to copy ID", "error");
    }
  }

  return (
    <article
      className="project-card group flex h-full flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 transition-colors hover:border-zinc-700 hover:bg-zinc-900/65"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-indigo-500/20 bg-indigo-500/10 text-indigo-400">
            <FolderKanban className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-snug text-zinc-100">
              <Link
                href={href}
                className="card-link inline-block min-h-6 break-words text-zinc-100 transition-colors group-hover:text-indigo-300"
              >
                {project.name}
              </Link>
            </h2>
            {updatedLabel ? (
              <p className="mt-0.5 text-xs text-zinc-500">
                Updated{" "}
                <time dateTime={project.updatedAt}>{updatedLabel}</time>
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {isPlaceholderName && !isRetired ? (
            <span className="inline-flex items-center rounded-full border border-zinc-700/80 bg-zinc-800/60 px-2 py-0.5 text-[11px] font-medium text-zinc-400">
              Untitled
            </span>
          ) : null}
          <span
            className={
              isRetired
                ? "inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300 [html[data-appearance='light']_&]:text-amber-700"
                : "inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400"
            }
          >
            {isRetired ? "Retired" : "Active"}
          </span>
          <ArrowUpRight
            className="h-4 w-4 text-zinc-500 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-indigo-400"
            aria-hidden="true"
          />
        </div>
      </header>

      <p
        className={
          project.description
            ? "line-clamp-2 text-sm leading-relaxed text-zinc-400"
            : "text-sm italic text-zinc-500"
        }
      >
        {project.description || "No description yet."}
      </p>

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/80 pt-3">
        <button
          type="button"
          onClick={() => void handleCopyId()}
          aria-label={`Copy ID for ${project.name}`}
          title="Copy project ID"
          className="inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1 font-mono text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <span className="truncate max-w-[160px] sm:max-w-[190px]">{project.id}</span>
          {copied ? (
            <Check className="h-3 w-3 shrink-0 text-emerald-400" aria-hidden="true" />
          ) : (
            <Copy className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden="true" />
          )}
        </button>

        {!isRetired ? (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              aria-label={`Edit ${project.name}`}
              onClick={() => onEdit(project)}
              className="h-8 gap-1.5 px-2.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Edit
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              aria-label={`Retire ${project.name}`}
              onClick={() => onRetire(project)}
              className="h-8 gap-1.5 px-2.5 text-xs text-zinc-400 hover:bg-red-500/10 hover:text-red-400 [html[data-appearance='light']_&]:hover:text-red-700"
            >
              <Archive className="h-3.5 w-3.5" aria-hidden="true" />
              Retire
            </Button>
          </div>
        ) : null}
      </footer>
    </article>
  );
}
