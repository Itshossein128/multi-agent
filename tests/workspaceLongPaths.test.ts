import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StudioStore, WorkspaceRepositoryState } from "../src/studio/contracts";
import { syncWorkspaceRepoWorkingCopy } from "../apps/server/src/api/studio/workspaceWorkingCopyService";

test("workspace sync checks out long paths through Git on Windows", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-longpaths-"));
  const source = path.join(root, "source");
  const relativeFile = [...Array(12).fill("nested-component"), "file.txt"].join("/");
  const previous = { ...process.env };
  let state: WorkspaceRepositoryState | undefined;
  const store = {
    listWorkspaceRepoStates: async () => state ? [state] : [],
    saveWorkspaceRepoState: async (value: WorkspaceRepositoryState) => { state = value; return value; },
  } as unknown as StudioStore;
  const git = (args: string[]) => execFileSync("git", ["-c", "core.longpaths=true", ...args], {
    cwd: source, stdio: "pipe", windowsHide: true,
  });
  try {
    await mkdir(path.dirname(path.join(source, relativeFile)), { recursive: true });
    await writeFile(path.join(source, relativeFile), "long path fixture\n");
    git(["init"]);
    git(["checkout", "-b", "fixture"]);
    git(["add", "."]);
    git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    const config = path.join(root, "gitconfig");
    await writeFile(config, "[core]\nlongpaths = false\n");
    process.env.GIT_CONFIG_GLOBAL = config;
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    process.env.STUDIO_WORKSPACE_STORAGE_ROOT = path.join(root, "workspaces");
    process.env.NODE_ENV = "development";
    delete process.env.JEST_WORKER_ID;
    const result = await syncWorkspaceRepoWorkingCopy(store, {
      tenantId: "tenant", projectId: "project", workspaceId: "workspace", branch: "fixture",
      repository: {
        id: "repository", tenantId: "tenant", projectId: "project", name: "fixture", source,
        defaultBranch: "fixture", status: "active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      },
    });
    expect(result.availability).toBe("ready");
    expect(result.hasUncommittedChanges).toBe(false);
    const checkedOut = path.join(process.env.STUDIO_WORKSPACE_STORAGE_ROOT, result.storagePath, relativeFile);
    expect(checkedOut.length).toBeGreaterThan(260);
    expect((await readFile(checkedOut, "utf8")).replace(/\r\n/g, "\n")).toBe("long path fixture\n");
    if (process.platform === "win32") {
      const repoPath = path.join(process.env.STUDIO_WORKSPACE_STORAGE_ROOT, result.storagePath);
      const longPathsConfig = execFileSync("git", ["-C", repoPath, "config", "--local", "--get", "core.longpaths"], {
        encoding: "utf8", windowsHide: true,
      });
      expect(longPathsConfig.trim()).toBe("true");
    }
  } finally {
    for (const key of ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "STUDIO_WORKSPACE_STORAGE_ROOT", "NODE_ENV", "JEST_WORKER_ID"]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
