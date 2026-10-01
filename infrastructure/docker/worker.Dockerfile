# syntax=docker/dockerfile:1

# The native CLI payloads below are Linux x64 only. A non-amd64 build must fail
# instead of silently producing an image containing incompatible executables.
FROM --platform=linux/amd64 node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS runtime-base
ARG TARGETPLATFORM=linux/amd64
RUN if [ "$TARGETPLATFORM" != "linux/amd64" ]; then \
      echo "worker.Dockerfile supports only linux/amd64; requested $TARGETPLATFORM" >&2; \
      exit 1; \
    fi

# Build a minimal Git-over-HTTPS filesystem from Debian package metadata. This
# avoids a fragile hand-maintained shared-library COPY list and does not require
# package-network access while building the final image.
FROM --platform=linux/amd64 node:22.23.2-bookworm@sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d AS git-source
COPY --from=runtime-base /var/lib/dpkg/status /tmp/runtime-status
RUN set -eux; \
    printf '%s\n' ca-certificates git > /tmp/git-closure; \
    while :; do \
      before="$(wc -l < /tmp/git-closure)"; \
      apt-cache depends --installed --no-recommends --no-suggests $(cat /tmp/git-closure) \
        | sed -n 's/^[ |]*\(Pre\)\?Depends: \([^ <][^ <]*\).*$/\2/p' \
        | sed 's/:amd64$//' \
        | sort -u >> /tmp/git-closure; \
      sort -u /tmp/git-closure -o /tmp/git-closure; \
      after="$(wc -l < /tmp/git-closure)"; \
      [ "$before" = "$after" ] && break; \
    done; \
    awk '/^Package: / { print $2 }' /tmp/runtime-status | sort -u > /tmp/runtime-packages; \
    comm -23 /tmp/git-closure /tmp/runtime-packages > /tmp/git-copy-packages; \
    mkdir -p /opt/git-root/usr/share/doc/multi-agent-worker; \
    while read -r package; do dpkg-query -L "$package"; done < /tmp/git-copy-packages \
      | sort -u \
      | while read -r path; do \
          case "$path" in \
            /bin/*|/lib/*|/sbin/*) path="/usr$path" ;; \
            /bin|/lib|/sbin) continue ;; \
          esac; \
          if [ -f "$path" ] || [ -L "$path" ]; then cp -a --parents "$path" /opt/git-root; fi; \
        done; \
    cp -a --parents /etc/ssl/certs /opt/git-root; \
    while read -r package; do dpkg-query -W "$package"; done < /tmp/git-closure \
      > /opt/git-root/usr/share/doc/multi-agent-worker/git-package-closure.txt; \
    test -x /opt/git-root/usr/bin/git; \
    test -x /opt/git-root/usr/lib/git-core/git-remote-https; \
    test ! -e /opt/git-root/usr/bin/ssh

# Build-only CLI installer. Remote archives are checksum-locked and remain in
# this throwaway stage rather than becoming layers in the runtime image.
FROM --platform=linux/amd64 node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS cli-source

ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

ADD --checksum=sha256:870663d4e65042dd358305e96a22af58708a28317cd4e74a85aa867c69f5859b https://registry.npmjs.org/@openai/codex/-/codex-0.154.0.tgz /tmp/codex.tgz
ADD --checksum=sha256:e27c83a49e6031685ee7f956c12aad5f16484d3a80181dd3fea930fb96b3832b https://registry.npmjs.org/@openai/codex/-/codex-0.154.0-linux-x64.tgz /tmp/codex-linux-x64.tgz
ADD --checksum=sha256:ee37736066e3349c977db70bdfaf4f3cf7c398a06e2a051fe8e00728e1f6e932 https://registry.npmjs.org/@anthropic-ai/claude-code/-/claude-code-2.1.270.tgz /tmp/claude-code.tgz
ADD --checksum=sha256:a2c0b69773f9da730b0616c19771094de51ffd23f0dfaa7c34ccead34eb76dd0 https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/-/claude-code-linux-x64-2.1.270.tgz /tmp/claude-code-linux-x64.tgz

# Cursor Agent CLI. Cursor does not publish checksums, so the digest below was
# recorded from the exact versioned artifact the official installer downloads
# (https://downloads.cursor.com/lab/<version>/linux/x64/agent-cli-package.tar.gz
# per https://cursor.com/install). BuildKit re-verifies it on every build; bump
# the version and refresh the checksum together after inspecting the new
# artifact. The package ships its own Node runtime, so it needs none from here.
ADD --checksum=sha256:b1308f5a2fc05458b9d8966752986bb23a971bbcc67c842c1df94c4b8132bad9 https://downloads.cursor.com/lab/2026.09.18-9a7762b/linux/x64/agent-cli-package.tar.gz /tmp/cursor-agent.tgz

RUN npm install --global --offline --omit=optional --ignore-scripts --no-audit --no-fund \
      /tmp/codex.tgz /tmp/claude-code.tgz \
    && mkdir -p \
      /usr/local/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64 \
      /usr/local/lib/node_modules/@anthropic-ai/claude-code/node_modules/@anthropic-ai/claude-code-linux-x64 \
    && tar --extract --gzip --file=/tmp/codex-linux-x64.tgz --strip-components=1 \
      --directory=/usr/local/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64 \
    && tar --extract --gzip --file=/tmp/claude-code-linux-x64.tgz --strip-components=1 \
      --directory=/usr/local/lib/node_modules/@anthropic-ai/claude-code/node_modules/@anthropic-ai/claude-code-linux-x64 \
    && node /usr/local/lib/node_modules/@anthropic-ai/claude-code/install.cjs \
    && mkdir -p /opt/cursor-agent \
    && tar --extract --gzip --file=/tmp/cursor-agent.tgz --strip-components=1 \
      --directory=/opt/cursor-agent \
    && test -x /opt/cursor-agent/cursor-agent \
    && test -x /opt/cursor-agent/node

# Keep the readable tag and immutable upstream manifest digest together.
FROM runtime-base

# Build proxy arguments are intentionally not inherited by the runtime image.
# In particular, a host-only loopback proxy must never become a worker runtime
# dependency or break installation of the pinned package-manager binary.
ENV HTTP_PROXY= \
    HTTPS_PROXY= \
    http_proxy= \
    https_proxy=

LABEL org.opencontainers.image.title="Multi-Agent CLI Worker" \
      org.opencontainers.image.description="Immutable non-root Codex, Claude Code, and Cursor Agent execution image" \
      org.opencontainers.image.base.name="docker.io/library/node:22.23.2-bookworm-slim" \
      org.opencontainers.image.version="codex-0.154.0_claude-2.1.270_cursor-2026.09.18-9a7762b"

ENV HOME=/home/worker \
    XDG_CONFIG_HOME=/home/worker/.config \
    XDG_CACHE_HOME=/home/worker/.cache \
    XDG_DATA_HOME=/home/worker/.local/share \
    CODEX_HOME=/home/worker/.codex \
    TMPDIR=/tmp \
    TMP=/tmp \
    TEMP=/tmp \
    SHELL=/bin/bash \
    DISABLE_AUTOUPDATER=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    GIT_TERMINAL_PROMPT=0

COPY --from=cli-source /usr/local/lib/node_modules/@openai/codex /usr/local/lib/node_modules/@openai/codex
COPY --from=cli-source /usr/local/lib/node_modules/@anthropic-ai/claude-code /usr/local/lib/node_modules/@anthropic-ai/claude-code
COPY --from=cli-source /opt/cursor-agent /opt/cursor-agent

COPY --from=git-source /opt/git-root/ /

# Docker 20.10 inherits the mountpoint mode for --tmpfs and may ignore its
# mode option, so the empty /home/worker mountpoint is created sticky-writable.
RUN ln -s ../lib/node_modules/@openai/codex/bin/codex.js /usr/local/bin/codex \
    && ln -s ../lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe /usr/local/bin/claude \
    && ln -s /opt/cursor-agent/cursor-agent /usr/local/bin/agent \
    && npm install --global --no-audit --no-fund pnpm@10.17.0 \
    && mkdir -p /tmp/cli-build-check/.codex /tmp/cli-build-check/.cache \
    && test "$(node --version)" = "v22.23.2" \
    && test "$(git --version)" = "git version 2.39.5" \
    && ! ldd /usr/lib/git-core/git-remote-https | grep --quiet 'not found' \
    && ! command -v ssh \
    && test "$(HOME=/tmp/cli-build-check CODEX_HOME=/tmp/cli-build-check/.codex codex --version)" = "codex-cli 0.154.0" \
    && test "$(pnpm --version)" = "10.17.0" \
    && HOME=/tmp/cli-build-check CODEX_HOME=/tmp/cli-build-check/.codex codex exec --help >/dev/null \
    && test "$(HOME=/tmp/cli-build-check claude --version)" = "2.1.270 (Claude Code)" \
    && HOME=/tmp/cli-build-check claude --help | grep --quiet -- "--print" \
    && test "$(HOME=/tmp/cli-build-check XDG_CACHE_HOME=/tmp/cli-build-check/.cache agent --version)" = "2026.09.18-9a7762b" \
    && HOME=/tmp/cli-build-check XDG_CACHE_HOME=/tmp/cli-build-check/.cache agent --help | grep --quiet -- "--print" \
    && rm -rf /tmp/cli-build-check \
    && install --directory --owner=65534 --group=65534 --mode=1777 /home/worker \
    && install --directory --owner=65534 --group=65534 --mode=0755 /workspace

USER 65534:65534
WORKDIR /workspace

CMD ["codex", "--version"]
