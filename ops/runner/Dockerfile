# Self-hosted GitHub Actions runner for SirCypkowskyy/inwards (see README.md).
#
# The runner itself comes from the official image, copied onto Ubuntu 26.04 so
# the "Test on ubuntu-26.04" check really runs on 26.04 (the official image is
# 24.04). Both tags float: inwards-runner-build.timer rebuilds weekly with
# --pull, which keeps the runner inside GitHub's 30-day update window.
FROM ghcr.io/actions/actions-runner:latest AS runner

FROM ubuntu:26.04
LABEL org.opencontainers.image.title="inwards-runner"

# What the workflows call directly or through their actions:
#   runner (.NET):  libicu78 libssl3t64 zlib1g libkrb5-3 tzdata ca-certificates
#   setup-bun/uv:   curl unzip tar gzip xz-utils zstd
#   ci.yml:         git bash jq python3, node + npx (ajv-cli), build-essential
#   bench.yml:      python3 (bench/generate.py), git worktree
#   sarif.yml:      jq
#   setup-python:   lsb-release, sudo (hosted runners have it too)
# No Docker CLI: no job that runs here needs one (cd.yml's musl check stays
# on GitHub-hosted runners).
ENV DEBIAN_FRONTEND=noninteractive \
    ImageOS=ubuntu26 \
    RUNNER_MANUALLY_TRAP_SIG=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates libicu78 libssl3t64 zlib1g libkrb5-3 tzdata \
       sudo lsb-release git curl jq unzip zip tar gzip xz-utils zstd \
       python3 python3-venv nodejs npm build-essential \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1001 -s /bin/bash runner \
    && echo 'runner ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/runner \
    && chmod 0440 /etc/sudoers.d/runner

COPY --from=runner --chown=runner:runner /home/runner /home/runner
USER runner
WORKDIR /home/runner
CMD ["/home/runner/run.sh"]
