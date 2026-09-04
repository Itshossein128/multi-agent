import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { VersionControlClient } from '../agents/developer/types';
import { GitHubClient } from './github';

const execAsync = promisify(exec);

export interface LocalGitConfig {
  workspaceRoot?: string;
  token?: string;
  owner?: string;
  gitUserName?: string;
  gitUserEmail?: string;
}

export class LocalGitClient implements VersionControlClient {
  private workspaceRoot: string;
  private token: string;
  private owner: string;
  private gitUserName: string;
  private gitUserEmail: string;
  private githubClient: GitHubClient;

  constructor(config?: LocalGitConfig, githubClient?: GitHubClient) {
    this.workspaceRoot =
      config?.workspaceRoot ||
      process.env.WORKSPACE_DIR ||
      path.join(process.cwd(), 'workspaces');
    this.token = config?.token || process.env.GITHUB_TOKEN || 'mock-github-token';
    this.owner = config?.owner || process.env.GITHUB_OWNER || 'my-github-username';
    this.gitUserName = config?.gitUserName || 'multi-agent-bot';
    this.gitUserEmail = config?.gitUserEmail || 'bot@multi-agent.local';
    this.githubClient = githubClient || new GitHubClient();

    if (!fs.existsSync(this.workspaceRoot)) {
      try {
        fs.mkdirSync(this.workspaceRoot, { recursive: true });
      } catch {
        // ignore
      }
    }
  }

  private isTestEnv(): boolean {
    return process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
  }

  getWorkspacePath(repo: string): string {
    return path.join(this.workspaceRoot, repo);
  }

  async cloneOrPull(repo: string): Promise<string> {
    const repoDir = this.getWorkspacePath(repo);

    if (this.isTestEnv()) {
      if (!fs.existsSync(repoDir)) {
        try {
          fs.mkdirSync(repoDir, { recursive: true });
        } catch {
          // ignore
        }
      }
      return repoDir;
    }

    const authCloneUrl = `https://x-access-token:${this.token}@github.com/${this.owner}/${repo}.git`;

    if (!fs.existsSync(path.join(repoDir, '.git'))) {
      if (fs.existsSync(repoDir)) {
        fs.rmSync(repoDir, { recursive: true, force: true });
      }
      console.log(`[LocalGit] Cloning ${this.owner}/${repo} into ${repoDir}...`);
      await execAsync(`git clone "${authCloneUrl}" "${repoDir}"`);

      // Configure local git committer for this repo
      await execAsync(`git -C "${repoDir}" config user.name "${this.gitUserName}"`);
      await execAsync(`git -C "${repoDir}" config user.email "${this.gitUserEmail}"`);
    } else {
      console.log(`[LocalGit] Updating existing clone at ${repoDir}...`);
      try {
        await execAsync(`git -C "${repoDir}" fetch origin`);
        await execAsync(`git -C "${repoDir}" checkout main`);
        await execAsync(`git -C "${repoDir}" pull origin main`);
      } catch (err: any) {
        console.warn(`[LocalGit] git pull warning: ${err.message}`);
      }
    }

    return repoDir;
  }

  async createBranch(
    repo: string,
    branchName: string
  ): Promise<{ branchName: string; success: boolean }> {
    if (this.isTestEnv()) {
      return { branchName, success: true };
    }

    const repoDir = await this.cloneOrPull(repo);
    try {
      await execAsync(`git -C "${repoDir}" checkout -B "${branchName}"`);
      return { branchName, success: true };
    } catch (err: any) {
      console.warn(`[LocalGit] Error creating branch ${branchName}: ${err.message}`);
      return this.githubClient.createBranch(repo, branchName);
    }
  }

  async commitFile(options: {
    repo: string;
    path: string;
    content: string;
    message: string;
    branch: string;
  }): Promise<{ success: boolean; sha?: string }> {
    if (this.isTestEnv()) {
      return { success: true, sha: 'mock-local-sha' };
    }

    try {
      const repoDir = await this.cloneOrPull(options.repo);
      const targetFilePath = path.join(repoDir, options.path);

      fs.mkdirSync(path.dirname(targetFilePath), { recursive: true });
      fs.writeFileSync(targetFilePath, options.content, 'utf-8');

      // Stage and commit locally
      await execAsync(`git -C "${repoDir}" add "${options.path}"`);
      const safeMsg = options.message.replace(/"/g, '\\"');
      await execAsync(`git -C "${repoDir}" commit -m "${safeMsg}"`);

      // Push to remote branch
      const authRemote = `https://x-access-token:${this.token}@github.com/${this.owner}/${options.repo}.git`;
      await execAsync(`git -C "${repoDir}" push -u "${authRemote}" "${options.branch}"`);

      const { stdout } = await execAsync(`git -C "${repoDir}" rev-parse HEAD`);
      return { success: true, sha: stdout.trim() };
    } catch (err: any) {
      console.warn(`[LocalGit] Local commit failed, falling back to GitHub API commit: ${err.message}`);
      return this.githubClient.commitFile(options);
    }
  }

  async createPullRequest(options: {
    repo: string;
    title: string;
    body: string;
    head: string;
    base?: string;
  }): Promise<{ prId: number; url: string; state: string }> {
    return this.githubClient.createPullRequest(options);
  }

  async getFileContent(repo: string, filePath: string): Promise<string | null> {
    const localPath = path.join(this.getWorkspacePath(repo), filePath);
    if (fs.existsSync(localPath)) {
      try {
        return fs.readFileSync(localPath, 'utf-8');
      } catch {
        // fallback
      }
    }
    return this.githubClient.getFileContent(repo, filePath);
  }

  async listRepositoryFiles(
    repo: string,
    dirPath: string = ''
  ): Promise<Array<{ name: string; path: string; type: 'file' | 'dir' }>> {
    const localDir = path.join(this.getWorkspacePath(repo), dirPath);
    if (fs.existsSync(localDir)) {
      try {
        const entries = fs.readdirSync(localDir, { withFileTypes: true });
        return entries
          .filter((e) => e.name !== '.git' && e.name !== 'node_modules')
          .map((e) => ({
            name: e.name,
            path: dirPath ? path.join(dirPath, e.name) : e.name,
            type: e.isDirectory() ? ('dir' as const) : ('file' as const),
          }));
      } catch {
        // fallback
      }
    }
    return this.githubClient.listRepositoryFiles(repo, dirPath);
  }

  async listRepositories(): Promise<Array<{ name: string }>> {
    return this.githubClient.listRepositories();
  }
}
