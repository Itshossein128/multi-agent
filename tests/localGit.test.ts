import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { LocalGitClient } from '../src/integrations/localGit';

jest.mock('child_process', () => {
  const original = jest.requireActual('child_process');
  return {
    ...original,
    execFile: jest.fn(),
  };
});

describe('LocalGitClient Security & Functionality', () => {
  const mockExecFile = child_process.execFile as unknown as jest.Mock;
  const workspaceRoot = path.join(__dirname, 'tmp_workspace');

  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock implementation for execFile callback
    mockExecFile.mockImplementation((file, args, options, callback) => {
      const cb = typeof options === 'function' ? options : callback;
      if (cb) {
        cb(null, { stdout: 'mock-stdout', stderr: '' });
      }
      return {} as child_process.ChildProcess;
    });

    if (fs.existsSync(workspaceRoot)) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(workspaceRoot)) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test('cloneOrPull uses execFile with safe argument arrays', async () => {
    const client = new LocalGitClient({
      workspaceRoot,
      token: 'test-token',
      owner: 'test-owner',
      gitUserName: 'test-user',
      gitUserEmail: 'test@example.com',
    });

    // Save and clear test flags so isTestEnv() returns false
    const oldEnv = process.env.NODE_ENV;
    const oldJestWorkerId = process.env.JEST_WORKER_ID;
    delete (process.env as any).NODE_ENV;
    delete (process.env as any).JEST_WORKER_ID;

    try {
      const repoDir = await client.cloneOrPull('my-repo');

      expect(mockExecFile).toHaveBeenNthCalledWith(
        1,
        'git',
        ['clone', 'https://x-access-token:test-token@github.com/test-owner/my-repo.git', repoDir],
        expect.any(Function)
      );
      expect(mockExecFile).toHaveBeenNthCalledWith(
        2,
        'git',
        ['-C', repoDir, 'config', 'user.name', 'test-user'],
        expect.any(Function)
      );
      expect(mockExecFile).toHaveBeenNthCalledWith(
        3,
        'git',
        ['-C', repoDir, 'config', 'user.email', 'test@example.com'],
        expect.any(Function)
      );
    } finally {
      (process.env as any).NODE_ENV = oldEnv;
      (process.env as any).JEST_WORKER_ID = oldJestWorkerId;
    }
  });

  test('prevents command injection payloads in repo name and git parameters', async () => {
    const client = new LocalGitClient({
      workspaceRoot,
      token: 'test-token',
      owner: 'test-owner',
      gitUserName: 'test-user',
      gitUserEmail: 'test@example.com',
    });

    const oldEnv = process.env.NODE_ENV;
    const oldJestWorkerId = process.env.JEST_WORKER_ID;
    delete (process.env as any).NODE_ENV;
    delete (process.env as any).JEST_WORKER_ID;

    try {
      const maliciousRepo = 'repo; touch /tmp/pwned; $(whoami)';
      const repoDir = await client.cloneOrPull(maliciousRepo);

      // Verify that execFile was called with the exact malicious string as an argument element,
      // NOT passed through a shell where `;` or `$()` would be executed.
      expect(mockExecFile).toHaveBeenNthCalledWith(
        1,
        'git',
        [
          'clone',
          `https://x-access-token:test-token@github.com/test-owner/${maliciousRepo}.git`,
          repoDir,
        ],
        expect.any(Function)
      );
    } finally {
      (process.env as any).NODE_ENV = oldEnv;
      (process.env as any).JEST_WORKER_ID = oldJestWorkerId;
    }
  });

  test('commitFile handles messages and paths with special metacharacters safely', async () => {
    const client = new LocalGitClient({
      workspaceRoot,
      token: 'test-token',
      owner: 'test-owner',
    });

    const oldEnv = process.env.NODE_ENV;
    const oldJestWorkerId = process.env.JEST_WORKER_ID;
    delete (process.env as any).NODE_ENV;
    delete (process.env as any).JEST_WORKER_ID;

    try {
      const repo = 'test-repo';
      const repoDir = client.getWorkspacePath(repo);
      fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });

      const maliciousMessage = 'feat: update"; echo "hacked"';
      const maliciousPath = 'src/file; id.txt';

      await client.commitFile({
        repo,
        path: maliciousPath,
        content: 'hello world',
        message: maliciousMessage,
        branch: 'main',
      });

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['-C', repoDir, 'add', maliciousPath],
        expect.any(Function)
      );
      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['-C', repoDir, 'commit', '-m', maliciousMessage],
        expect.any(Function)
      );
    } finally {
      (process.env as any).NODE_ENV = oldEnv;
      (process.env as any).JEST_WORKER_ID = oldJestWorkerId;
    }
  });
});
