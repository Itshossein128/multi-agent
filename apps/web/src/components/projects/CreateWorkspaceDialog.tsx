"use client";

import React, { useId, useRef, useState } from "react";
import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModalShell } from "@/components/projects/ModalShell";

export interface ProjectRepoOption {
  id: string;
  name: string;
  defaultBranch: string;
}

interface CreateWorkspaceDialogProps {
  open: boolean;
  repositories: ProjectRepoOption[];
  onClose: () => void;
  onCreate: (payload: {
    name?: string;
    repositories?: Array<{ projectRepositoryId: string; branch: string }>;
  }) => Promise<void>;
}

/** Modal dialog for creating an explicit project workspace with per-repository branch choices. */
export function CreateWorkspaceDialog({
  open,
  repositories,
  onClose,
  onCreate,
}: CreateWorkspaceDialogProps) {
  if (!open) return null;
  return (
    <CreateWorkspaceDialogContent
      repositories={repositories}
      onClose={onClose}
      onCreate={onCreate}
    />
  );
}

function CreateWorkspaceDialogContent({
  repositories,
  onClose,
  onCreate,
}: Omit<CreateWorkspaceDialogProps, "open">) {
  const titleId = useId();
  const nameId = useId();
  const nameHintId = useId();
  const repoErrorId = useId();
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [selectedRepos, setSelectedRepos] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(repositories.map((repo) => [repo.id, true])),
  );
  const [branches, setBranches] = useState<Record<string, string>>(() =>
    Object.fromEntries(repositories.map((repo) => [repo.id, repo.defaultBranch])),
  );
  const [repoError, setRepoError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const chosen = repositories.filter((repo) => selectedRepos[repo.id] !== false);
    if (repositories.length > 0 && chosen.length === 0) {
      setRepoError("Select at least one repository for this workspace.");
      return;
    }

    setSubmitting(true);
    setRepoError(null);
    setSubmitError(null);
    try {
      const payload: {
        name?: string;
        repositories?: Array<{ projectRepositoryId: string; branch: string }>;
      } = name.trim() ? { name: name.trim() } : {};

      if (repositories.length > 0) {
        payload.repositories = chosen.map((repo) => ({
          projectRepositoryId: repo.id,
          branch: (branches[repo.id] ?? repo.defaultBranch).trim() || repo.defaultBranch,
        }));
      }

      await onCreate(payload);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Create workspace failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell
      titleId={titleId}
      busy={submitting}
      initialFocusRef={nameInputRef}
      onClose={onClose}
      header={
        <div>
          <h2 id={titleId} className="text-lg font-semibold text-zinc-100">
            New Workspace
          </h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            Isolate branches and workspace-level setting overrides for this project.
          </p>
        </div>
      }
    >
      <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor={nameId} className="block text-xs font-medium text-zinc-200">
            Workspace name <span className="font-normal text-zinc-500">(optional)</span>
          </label>
          <p id={nameHintId} className="text-xs text-zinc-500">
            Leave blank to generate a workspace name automatically.
          </p>
          <input
            ref={nameInputRef}
            id={nameId}
            name="workspaceName"
            type="text"
            value={name}
            maxLength={120}
            aria-describedby={nameHintId}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Staging, Release Candidate"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          />
        </div>

        {repositories.length > 0 ? (
          <fieldset className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3.5">
            <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Repositories &amp; initial branches
            </legend>
            <div className="space-y-2.5">
              {repositories.map((repo) => {
                const checked = selectedRepos[repo.id] !== false;
                const checkboxId = `ws-repo-${repo.id}`;
                const branchId = `ws-branch-${repo.id}`;
                return (
                  <div
                    key={repo.id}
                    className="flex flex-col gap-2 rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-2.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <label
                      htmlFor={checkboxId}
                      className="flex min-h-6 cursor-pointer items-center gap-2 text-sm text-zinc-200"
                    >
                      <input
                        id={checkboxId}
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const next = event.target.checked;
                          setSelectedRepos((prev) => ({ ...prev, [repo.id]: next }));
                          if (next) setRepoError(null);
                        }}
                        className="h-4 w-4 rounded accent-indigo-500"
                      />
                      <span className="truncate font-medium">{repo.name}</span>
                    </label>
                    {checked ? (
                      <div className="flex items-center gap-1.5">
                        <GitBranch className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
                        <label htmlFor={branchId} className="sr-only">
                          Branch for {repo.name}
                        </label>
                        <input
                          id={branchId}
                          type="text"
                          value={branches[repo.id] ?? repo.defaultBranch}
                          onChange={(event) =>
                            setBranches((prev) => ({ ...prev, [repo.id]: event.target.value }))
                          }
                          placeholder={repo.defaultBranch}
                          className="h-8 w-full min-w-[9rem] rounded-md border border-zinc-800 bg-zinc-900 px-2.5 font-mono text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 sm:w-44"
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {repoError ? (
              <p
                id={repoErrorId}
                role="alert"
                className="text-xs text-red-400 [html[data-appearance='light']_&]:text-red-700"
              >
                {repoError}
              </p>
            ) : null}
          </fieldset>
        ) : null}

        {submitError ? (
          <div
            role="alert"
            className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300 [html[data-appearance='light']_&]:text-red-700"
          >
            {submitError}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" size="sm" disabled={submitting} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={submitting}
            className="bg-indigo-600 text-white hover:bg-indigo-500"
          >
            {submitting ? "Creating…" : "Create workspace"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}
