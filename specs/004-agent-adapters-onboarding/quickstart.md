# Quickstart: Server-Owned Agent Adapters and Guided First-Run Onboarding

**Feature**: [spec.md](./spec.md) | **Date**: 2026-10-04

## 1. Guided First-Run Onboarding

Run the onboarding tool to inspect your environment, detect pending database migrations, and verify runtime event dispatching with an offline in-memory event smoke test:

```bash
# Check prerequisites, detect pending migrations, and run offline in-memory event smoke
pnpm cli onboard

# Apply pending PostgreSQL migrations and run diagnostic check
pnpm cli onboard --migrate

# Output machine-readable JSON report
pnpm cli onboard --json
```

The onboarding flow:
- Checks Node.js runtime (>= 20) and operating system platform.
- Connects to PostgreSQL via `DATABASE_URL` or `STUDIO_DATABASE_URL` (never falls back to test databases).
- Surfaces pending migrations from `studio_migrations` and `studio_memory_migrations` without applying them unless `--migrate` is supplied.
- Executes an offline in-memory event smoke test (verifies in-memory event streaming and dispatcher contracts without external LLMs or database records).
- Reports passive diagnostic presence of external providers (OpenAI, Anthropic, Gemini, Process Adapter, Webhook Adapter) with zero billable API calls.

---

## 2. Configuring an Allowlisted Local Process Agent

1. Set server policy in `.env` / environment:
   ```bash
   PROCESS_AGENT_ENABLED=true
   PROCESS_AGENT_TRUSTED_HOST_ALLOWED=true   # Explicit opt-in required for host execution
   PROCESS_AGENT_ALLOWED_COMMANDS=/usr/bin/my-tool,echo,cat
   PROCESS_AGENT_ALLOWED_ARG_PATTERNS=^--format=(json|yaml)$,^--verbose$
   PROCESS_AGENT_WORKSPACE_ROOTS=/home/user/workspaces
   ```
2. Note on multi-tenancy: Host execution is strictly restricted to trusted operators. For untrusted/multi-tenant workloads, set `CLI_WORKER_MODE=container` to isolate execution inside a Docker/container worker or execution fails closed.
3. Create an agent definition:
   ```json
   {
     "name": "Local Formatter",
     "backend": {
       "type": "process",
       "command": "/usr/bin/my-tool",
       "args": ["--format=json"]
     },
     "systemPrompt": "Formats workflow results",
     "tools": []
   }
   ```

---

## 3. Configuring an External HTTP / Webhook Agent

1. Set server policy in `.env` / environment:
   ```bash
   WEBHOOK_AGENT_ENABLED=true
   WEBHOOK_AGENT_ALLOWED_HOSTS=webhook.partner.com,api.partner.org  # Empty allowlist fails closed!
   ```
2. Note on anti-SSRF & DNS rebinding:
   - Target URLs must resolve to public, non-private routable IP addresses.
   - Socket connection-time IP validation (`createPinnedSsrfDispatcher`) blocks DNS rebinding at TCP connect time.
   - Redirect targets are re-validated against the SSRF policy; authorization headers are automatically stripped if redirects change the origin.
   - Leased credential tokens will never be transmitted over unencrypted HTTP.
3. Provision credential alias in credential broker or environment:
   ```bash
   TOOL_WEBHOOK_PARTNER_AUTH_TOKEN=secret-token-value
   ```
4. Create an agent definition:
   ```json
   {
     "name": "Partner Review Agent",
     "backend": {
       "type": "webhook",
       "url": "https://webhook.partner.com/agent/v1",
       "method": "POST",
       "credentialAlias": "partner-auth"
     },
     "systemPrompt": "External review",
     "tools": []
   }
   ```

