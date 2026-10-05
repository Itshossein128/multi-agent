# Data Model: Server-Owned Agent Adapters and Guided First-Run Onboarding

**Feature**: [spec.md](./spec.md) | **Date**: 2026-10-04

## Entity Models & Contracts

### 1. AgentBackend Union Extension (`@multi-agent/types`)

```typescript
export type AgentBackend =
  | {
      type: "api";
      provider: string;
      model: string;
      settings?: AgentModelSettings;
    }
  | {
      type: "cli";
      provider: "codex" | "claude-code" | "agy" | "cursor" | (string & {});
      model?: string;
      executable?: string;
      args?: string[];
    }
  | {
      type: "local";
      provider: "ollama" | "lmstudio" | (string & {});
      model: string;
      baseUrl?: string;
      settings?: AgentModelSettings;
    }
  | {
      type: "process";
      /** Server-allowlisted command alias or bare name */
      command: string;
      args?: string[];
      /** Optional working directory within allowed workspace roots */
      workspaceRoot?: string;
    }
  | {
      type: "webhook";
      /** Strict HTTP(S) URL */
      url: string;
      method?: "POST" | "PUT";
      /** Broker credential alias for outbound bearer token */
      credentialAlias?: string;
      timeoutMs?: number;
      headers?: Record<string, string>;
    };
```

### 2. Server Runtime Policies (`src/agents/runtime/`)

#### Process Runtime Policy
```typescript
export interface ProcessRuntimePolicy {
  enabled: boolean;
  workerMode: "local" | "container";
  /** Trusted-only flag: if false, host execution in local mode is forbidden */
  trustedHostAllowed: boolean;
  allowedCommands: string[];
  workspaceRoots: string[];
  maxOutputBytes: number;
}
```

#### Webhook Destination Policy
```typescript
export interface WebhookDestinationPolicy {
  enabled: boolean;
  allowedHosts: string[];
  allowPrivateIps: boolean; // default: false
  maxResponseBytes: number; // default: 2MB
  defaultTimeoutMs: number; // default: 30000
}
```

### 3. Credential Broker Provider Extension (`src/broker/contract.ts`)

```typescript
export type CredentialProvider =
  | "openai"
  | "anthropic"
  | "gemini"
  | "codex"
  | "claude-code"
  | "cursor"
  | "agy"
  | "database"
  | "search"
  | "mcp"
  | "webhook";
```

### 4. Onboarding Report (`src/cli/onboard.ts`)

```typescript
export interface OnboardingReport {
  environment: {
    nodeVersion: string;
    platform: string;
  };
  database: {
    connected: boolean;
    urlConfigured: boolean;
    pendingMigrations: string[];
    appliedMigrations: string[];
  };
  selfTest: {
    executed: boolean;
    success: boolean;
    runId?: string;
    durationMs?: number;
    error?: string;
  };
  providers: Array<{
    name: string;
    type: "api" | "cli" | "local";
    ready: boolean;
    details: string;
  }>;
}
```
