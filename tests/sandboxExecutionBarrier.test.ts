import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import {
  SandboxBoundaryViolationError,
  SandboxExecutionBarrier,
  SandboxHostProtectionViolationError,
  applySandboxWorkerBarrier,
  assertSandboxExecutionPolicy,
} from "../src/security";
import type { AgentRecord } from "@multi-agent/types";
import type { WorkerSpec } from "../src/agents/runtime/workerRuntime";
import { assertExecutionPolicy, ExecutionPolicyError } from "../src/agents/runtime/executionPolicy";

describe("SandboxExecutionBarrier Security & Boundary Tests (T020 - T024)", () => {
  const hostRepoPath = "/home/hossein/Desktop/projects/building-management";
  const sandboxRoot = path.resolve(process.cwd(), "workspaces/building-management-sandbox");
  let hostGitStatusBefore: string = "";

  beforeAll(() => {
    // Ensure sandbox root exists
    if (!fs.existsSync(sandboxRoot)) {
      fs.mkdirSync(sandboxRoot, { recursive: true });
    }

    // Capture initial git status of host repository if it exists
    if (fs.existsSync(hostRepoPath) && fs.existsSync(path.join(hostRepoPath, ".git"))) {
      try {
        hostGitStatusBefore = execSync(`git -C "${hostRepoPath}" status --porcelain`, {
          encoding: "utf-8",
        });
      } catch {
        hostGitStatusBefore = "";
      }
    }
  });

  afterAll(() => {
    // Cleanup any temporary files created inside sandbox during test
    const testFile = path.join(sandboxRoot, ".sandbox-barrier-test-file.txt");
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
    const testSubdir = path.join(sandboxRoot, "tmp-test-dir");
    if (fs.existsSync(testSubdir)) {
      fs.rmSync(testSubdir, { recursive: true, force: true });
    }
  });

  describe("SandboxExecutionBarrier", () => {
    const barrier = new SandboxExecutionBarrier(sandboxRoot, [hostRepoPath]);

    test("permits reads and writes inside workspaces/building-management-sandbox", () => {
      const allowedFilePath = path.join(sandboxRoot, ".sandbox-barrier-test-file.txt");
      const allowedSubdirPath = path.join(sandboxRoot, "tmp-test-dir", "nested.txt");

      // Assert path permissions
      expect(() => barrier.assertPathAllowed(allowedFilePath, "read")).not.toThrow();
      expect(() => barrier.assertPathAllowed(allowedFilePath, "write")).not.toThrow();
      expect(() => barrier.assertPathAllowed(allowedSubdirPath, "write")).not.toThrow();
      expect(barrier.isPathAllowed(allowedFilePath, "write")).toBe(true);

      // Perform actual file write inside sandbox
      fs.writeFileSync(allowedFilePath, "sandbox test content", "utf-8");
      expect(fs.readFileSync(allowedFilePath, "utf-8")).toBe("sandbox test content");
    });

    test("rejects write operations targeting /home/hossein/Desktop/projects/building-management", () => {
      const hostFilePath = path.join(hostRepoPath, "unauthorized-file.txt");
      const hostSubdirPath = path.join(hostRepoPath, "src", "unauthorized.ts");

      // Verify write attempt throws SandboxHostProtectionViolationError
      expect(() => barrier.assertPathAllowed(hostFilePath, "write")).toThrow(
        SandboxHostProtectionViolationError,
      );
      expect(() => barrier.assertPathAllowed(hostSubdirPath, "write")).toThrow(
        SandboxHostProtectionViolationError,
      );

      // Verify read attempt to host repository is also blocked fail-closed
      expect(() => barrier.assertPathAllowed(hostFilePath, "read")).toThrow(
        SandboxHostProtectionViolationError,
      );
      expect(barrier.isPathAllowed(hostFilePath, "write")).toBe(false);
    });

    test("blocks path traversal attacks (e.g., ../../ escapes)", () => {
      // 1. Escaping sandbox root to host project via traversal
      const traversalToHost = path.join(sandboxRoot, "../../../building-management/unauthorized.txt");
      expect(() => barrier.assertPathAllowed(traversalToHost, "write")).toThrow();

      // 2. Escaping sandbox root to system locations (e.g. /etc or /tmp)
      const traversalOutside = path.join(sandboxRoot, "../../outside-file.txt");
      expect(() => barrier.assertPathAllowed(traversalOutside, "write")).toThrow(
        SandboxBoundaryViolationError,
      );

      // 3. Deep relative path traversal
      const deepTraversal = path.join(sandboxRoot, "a/b/c/../../../../../../etc/passwd");
      expect(() => barrier.assertPathAllowed(deepTraversal, "write")).toThrow();
    });

    test("confirms host repository git status is 100% clean post-execution", () => {
      if (fs.existsSync(hostRepoPath) && fs.existsSync(path.join(hostRepoPath, ".git"))) {
        const hostGitStatusAfter = execSync(`git -C "${hostRepoPath}" status --porcelain`, {
          encoding: "utf-8",
        });

        // The host repository status must remain 100% unchanged - zero mutations occurred
        expect(hostGitStatusAfter).toBe(hostGitStatusBefore);
      }
    });

    test("handles symlinks pointing outside the sandbox fail-closed", () => {
      const symlinkPath = path.join(sandboxRoot, "tmp-symlink-escape");
      const outsideSymlinkPath = path.join(sandboxRoot, "tmp-outside-escape");
      try {
        try {
          fs.unlinkSync(symlinkPath);
        } catch {}
        try {
          fs.unlinkSync(outsideSymlinkPath);
        } catch {}

        // 1. Point symlink to forbidden host repo (even if host repo path does not exist on disk)
        fs.symlinkSync(hostRepoPath, symlinkPath, "dir");

        const escapeViaSymlink = path.join(symlinkPath, "escaped.txt");
        expect(() => barrier.assertPathAllowed(escapeViaSymlink, "write")).toThrow(
          SandboxHostProtectionViolationError,
        );
        expect(() => barrier.assertPathAllowed(escapeViaSymlink, "read")).toThrow(
          SandboxHostProtectionViolationError,
        );

        // 2. Point symlink to arbitrary outside non-host path
        fs.symlinkSync("/tmp/some-outside-dir", outsideSymlinkPath, "dir");
        const outsideViaSymlink = path.join(outsideSymlinkPath, "outside.txt");
        expect(() => barrier.assertPathAllowed(outsideViaSymlink, "write")).toThrow(
          SandboxBoundaryViolationError,
        );
      } finally {
        try {
          fs.unlinkSync(symlinkPath);
        } catch {}
        try {
          fs.unlinkSync(outsideSymlinkPath);
        } catch {}
      }
    });
  });

  describe("Subprocess & Worker Runtime Confinement (T023)", () => {
    const barrier = new SandboxExecutionBarrier(sandboxRoot, [hostRepoPath]);

    test("applySandboxWorkerBarrier permits execution within sandbox root", () => {
      const validSpec: WorkerSpec = {
        runId: "run-test-1",
        nodeId: "node-1",
        agentId: "agent-qa",
        executable: "git",
        args: ["status"],
        cwd: sandboxRoot,
        timeoutMs: 30000,
        maxOutputBytes: 1024 * 1024,
      };

      const result = applySandboxWorkerBarrier(validSpec, barrier);
      expect(result.cwd).toBe(barrier.canonicalSandboxRoot);
    });

    test("applySandboxWorkerBarrier defaults empty cwd to canonicalSandboxRoot", () => {
      const specWithoutCwd: WorkerSpec = {
        runId: "run-test-2",
        nodeId: "node-2",
        agentId: "agent-qa",
        executable: "node",
        args: ["-v"],
        cwd: "",
        timeoutMs: 30000,
        maxOutputBytes: 1024 * 1024,
      };

      const result = applySandboxWorkerBarrier(specWithoutCwd, barrier);
      expect(result.cwd).toBe(barrier.canonicalSandboxRoot);
    });

    test("applySandboxWorkerBarrier rejects cwd targeting protected host path", () => {
      const hostileSpec: WorkerSpec = {
        runId: "run-test-3",
        nodeId: "node-3",
        agentId: "agent-malicious",
        executable: "git",
        args: ["clean", "-fdx"],
        cwd: hostRepoPath,
        timeoutMs: 30000,
        maxOutputBytes: 1024 * 1024,
      };

      expect(() => applySandboxWorkerBarrier(hostileSpec, barrier)).toThrow(
        SandboxHostProtectionViolationError,
      );
    });

    test("applySandboxWorkerBarrier rejects arguments referencing protected host paths", () => {
      const hostileArgsSpec: WorkerSpec = {
        runId: "run-test-4",
        nodeId: "node-4",
        agentId: "agent-malicious",
        executable: "git",
        args: ["diff", hostRepoPath],
        cwd: sandboxRoot,
        timeoutMs: 30000,
        maxOutputBytes: 1024 * 1024,
      };

      expect(() => applySandboxWorkerBarrier(hostileArgsSpec, barrier)).toThrow(
        SandboxHostProtectionViolationError,
      );
    });
  });

  describe("Agent Execution Policy Confinement (T022)", () => {
    test("assertSandboxExecutionPolicy blocks agent targeting protected host path", () => {
      const hostileAgent: AgentRecord = {
        id: "agent-hacker",
        tenantId: "tenant-1",
        name: "Hostile Code Writer",
        description: "Attempts write on host",
        systemPrompt: "write code",
        tools: [],
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        backend: {
          type: "cli",
          provider: "openai",
          executable: "git",
        },
        executionPolicy: {
          shell: "restricted",
          workspaceRoot: hostRepoPath,
          allowedCommands: ["git"],
        },
      };

      expect(() => assertSandboxExecutionPolicy(hostileAgent)).toThrow(
        SandboxHostProtectionViolationError,
      );
    });

    test("assertSandboxExecutionPolicy passes when workspaceRoot is in sandbox", () => {
      const validAgent: AgentRecord = {
        id: "agent-legit",
        tenantId: "tenant-1",
        name: "Legit Sandbox Engineer",
        description: "Operates inside sandbox",
        systemPrompt: "write code",
        tools: [],
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        backend: {
          type: "cli",
          provider: "openai",
          executable: "git",
        },
        executionPolicy: {
          shell: "restricted",
          workspaceRoot: sandboxRoot,
          allowedCommands: ["git"],
        },
      };

      const previousRoot = process.env.SANDBOX_CANONICAL_ROOT;
      process.env.SANDBOX_CANONICAL_ROOT = sandboxRoot;
      try {
        expect(() => assertSandboxExecutionPolicy(validAgent)).not.toThrow();
      } finally {
        if (previousRoot === undefined) delete process.env.SANDBOX_CANONICAL_ROOT;
        else process.env.SANDBOX_CANONICAL_ROOT = previousRoot;
      }
    });

    test("live execution policy rejects a missing workspace and a path outside the sandbox", () => {
      const previousRoot = process.env.SANDBOX_CANONICAL_ROOT;
      delete process.env.SANDBOX_CANONICAL_ROOT;
      const base = {
        id: "agent-policy",
        tenantId: "tenant-1",
        name: "Policy Agent",
        description: "policy",
        systemPrompt: "work",
        tools: [],
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        backend: { type: "process" as const, command: "node" },
      };
      try {
        expect(() => assertExecutionPolicy(base as AgentRecord)).toThrow(ExecutionPolicyError);
        expect(() => assertExecutionPolicy({
          ...base,
          executionPolicy: { workspaceRoot: "/tmp/outside-sandbox" },
        } as AgentRecord)).toThrow(SandboxBoundaryViolationError);
      } finally {
        if (previousRoot === undefined) delete process.env.SANDBOX_CANONICAL_ROOT;
        else process.env.SANDBOX_CANONICAL_ROOT = previousRoot;
      }
    });
  });
});
