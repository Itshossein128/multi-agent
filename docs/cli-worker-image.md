# Immutable CLI worker image

The hardened container runtime uses a dedicated Linux/amd64 image containing only Node.js, Git, Bash, CA certificates, Codex CLI, Claude Code, the Cursor Agent CLI, and their runtime libraries. It contains no credentials, login state, SSH keys, or user configuration. SSH is intentionally absent; add it only if an approved deployment requires Git-over-SSH rather than HTTPS. The Dockerfile rejects any target other than `linux/amd64`; the pinned native CLI packages do not support another architecture in this image.

Pinned components:

- Node.js `22.23.2` on Debian Bookworm slim, base manifest `sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5`
- `@openai/codex` `0.154.0`
- `@anthropic-ai/claude-code` `2.1.270`
- Cursor Agent CLI `2026.09.18-9a7762b` (`/opt/cursor-agent`, symlinked as `/usr/local/bin/agent`)

The Cursor Agent CLI tarball is the exact versioned artifact the official installer downloads, locked with a recorded SHA-256 digest that BuildKit verifies on every build. Cursor does not publish checksums; after bumping the version, record the new artifact's digest in `infrastructure/docker/worker.Dockerfile` at the same time. The CLI attempts runtime auto-updates, but the read-only root filesystem and the non-writable install location (`/opt/cursor-agent`) prevent image mutation, so the pinned artifact remains the effective version. The package ships its own Node runtime and writes only to the per-run `XDG_CACHE_HOME` tmpfs.

Claude self-updates and npm update notifications are disabled. Codex is installed into the immutable global Node prefix and cannot update the read-only root filesystem at runtime.

## Build and smoke test

From the repository root:

```powershell
docker build --pull --platform linux/amd64 --build-arg HTTP_PROXY --build-arg HTTPS_PROXY --build-arg NO_PROXY --file infrastructure/docker/worker.Dockerfile --tag multi-agent-cli-worker:local infrastructure/docker
pnpm worker:image:smoke -- multi-agent-cli-worker:local
```

The smoke test runs the same isolation arguments produced by `buildContainerArgs`. It verifies all three CLI entry points (`codex`, `claude`, `agent`), non-root execution, writable temporary home/config/cache paths, read-only root and workspace behavior, optional writable workspace behavior, no external network interface, and `--rm` cleanup.

The proxy arguments are Docker predefined build arguments. They forward values only when corresponding variables exist in the invoking environment and are not persisted in the image configuration or history. The checksum-pinned CLI archives are fetched by BuildKit and installed offline inside the image.

Git and CA files are derived from Debian's installed package metadata in a throwaway stage. The stage computes the dependency closure for `git` and `ca-certificates`, copies only package-owned files absent from the slim runtime base, and records the resolved package/version manifest at `/usr/share/doc/multi-agent-worker/git-package-closure.txt`. This preserves Git-over-HTTPS without shipping the full build image or an SSH executable.

## Publish and select an immutable digest

A local image ID is not a registry manifest digest and must not be placed in `CLI_WORKER_IMAGE`. Tag and push the image to the deployment registry, then read the pushed repository digest:

```powershell
docker tag multi-agent-cli-worker:local registry.example/multi-agent-cli-worker:codex-0.154.0-claude-2.1.270
docker push registry.example/multi-agent-cli-worker:codex-0.154.0-claude-2.1.270
docker image inspect registry.example/multi-agent-cli-worker:codex-0.154.0-claude-2.1.270 --format '{{index .RepoDigests 0}}'
```

If inspection prints:

```text
registry.example/multi-agent-cli-worker@sha256:<64-hex-manifest-digest>
```

configure that complete value:

```dotenv
CLI_AGENT_ENABLED=true
CLI_AGENT_ALLOWED_EXECUTABLES=codex,claude,agent
CLI_AGENT_WORKSPACE_ROOTS=/absolute/host/path/to/allowed/workspaces
CLI_WORKER_MODE=container
CLI_WORKER_IMAGE=registry.example/multi-agent-cli-worker@sha256:<64-hex-manifest-digest>
CLI_WORKER_USER=65534:65534
CLI_WORKER_ALLOW_NETWORK=false
```

The image expects `/home/worker` and `/tmp` to be runtime tmpfs mounts and `/workspace` to be the sole project bind. CLI provider calls cannot succeed while network access is disabled; enabling network later requires both the server setting and the individual agent policy. Authentication and credential injection are deliberately not configured by this image.

Every runtime launch recreates `.codex`, `.claude`, `.config`, `.cache`, and `.local/share` inside the fresh `/home/worker` tmpfs as the configured non-root worker, with mode `0700`. The runtime fixes `CLAUDE_CONFIG_DIR=/home/worker/.claude` and `CLAUDE_CODE_SKIP_PROMPT_HISTORY=1`. Container workers set `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0` because Claude Code 2.1.270 requires bubblewrap for scrub mode and this image does not include bubblewrap; Docker isolation remains the security boundary. These paths and hardening values cannot be overridden by worker configuration.

The server includes disabled-by-default development adapters for credential delivery. Codex subscription auth can use file delivery of only `auth.json`. Claude Code subscription auth can use file delivery of only `.credentials.json` into `/home/worker/.claude/.credentials.json`, with usability validation and CAS writeback. Environment delivery remains available for explicit API-key experiments; when enabled, only the selected provider credential name is included in Docker arguments and its value is redacted from worker output. Docker still stores environment credentials in container configuration. Neither mechanism mounts local login files, host home directories, `.codex`, or `.claude` directories, and neither is a production multi-tenant security boundary.
