# Immutable CLI worker image

The hardened container runtime uses a dedicated Linux/amd64 image containing only Node.js, Git, Bash, CA certificates, Codex CLI, Claude Code, and their runtime libraries. It contains no credentials, login state, SSH keys, or user configuration. SSH is intentionally absent; add it only if an approved deployment requires Git-over-SSH rather than HTTPS. The Dockerfile rejects any target other than `linux/amd64`; the pinned native CLI packages do not support another architecture in this image.

Pinned components:

- Node.js `22.23.2` on Debian Bookworm slim, base manifest `sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5`
- `@openai/codex` `0.154.0`
- `@anthropic-ai/claude-code` `2.1.270`

Claude self-updates and npm update notifications are disabled. Codex is installed into the immutable global Node prefix and cannot update the read-only root filesystem at runtime.

## Build and smoke test

From the repository root:

```powershell
docker build --pull --platform linux/amd64 --build-arg HTTP_PROXY --build-arg HTTPS_PROXY --build-arg NO_PROXY --file infrastructure/docker/worker.Dockerfile --tag multi-agent-cli-worker:local infrastructure/docker
pnpm worker:image:smoke -- multi-agent-cli-worker:local
```

The smoke test runs the same isolation arguments produced by `buildContainerArgs`. It verifies both CLI entry points, non-root execution, writable temporary home/config/cache paths, read-only root and workspace behavior, optional writable workspace behavior, no external network interface, and `--rm` cleanup.

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
CLI_AGENT_ALLOWED_EXECUTABLES=codex,claude
CLI_AGENT_WORKSPACE_ROOTS=/absolute/host/path/to/allowed/workspaces
CLI_WORKER_MODE=container
CLI_WORKER_IMAGE=registry.example/multi-agent-cli-worker@sha256:<64-hex-manifest-digest>
CLI_WORKER_USER=65534:65534
CLI_WORKER_ALLOW_NETWORK=false
```

The image expects `/home/worker` and `/tmp` to be runtime tmpfs mounts and `/workspace` to be the sole project bind. CLI provider calls cannot succeed while network access is disabled; enabling network later requires both the server setting and the individual agent policy. Authentication and credential injection are deliberately not configured by this image.
