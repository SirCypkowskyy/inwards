#!/usr/bin/env bash
# One runner slot, started by inwards-runner@<slot>.service.
#
# Loop: register a just-in-time runner (GitHub gives it exactly one job and
# then removes it), run it in a fresh container that is deleted when the job
# ends, repeat. No state survives between jobs. The PAT stays on the host: the
# container only gets the single-use JIT config.
set -euo pipefail

slot="${1:?usage: runner.sh <slot>}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Reads .env again before every job, so a rotated token needs no restart.
load_env() {
  set -a
  # shellcheck source=/dev/null
  source "$here/.env"
  set +a
}
load_env

repo="${RUNNER_REPO:-SirCypkowskyy/inwards}"
image="${RUNNER_IMAGE:-inwards-runner:latest}"
prefix="${RUNNER_NAME_PREFIX:-$(hostname -s)}-$slot"
container="inwards-runner-$slot"
api="https://api.github.com/repos/$repo/actions/runners"

if [[ -z "${GITHUB_PAT:-}" ]]; then
  echo "GITHUB_PAT is not set in $here/.env; see README.md. Retrying in 5 minutes."
  sleep 300
  exit 1
fi

# Calls the repository's runners API: gh_api METHOD PATH [JSON_BODY].
gh_api() {
  curl -fsS -X "$1" \
    -H "Authorization: Bearer $GITHUB_PAT" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$api$2" ${3:+--data "$3"}
}

# systemctl stop: let the runner finish its shutdown, then leave.
trap 'docker stop -t 30 "$container" >/dev/null 2>&1 || true; exit 0' TERM INT

while true; do
  load_env
  docker rm -f "$container" >/dev/null 2>&1 || true

  # A runner that never picked up a job (reboot, crash) stays registered as
  # offline. Remove this slot's leftovers before registering a new one.
  if runners="$(gh_api GET "?per_page=100")"; then
    jq -r --arg p "$prefix-" \
      '.runners[] | select(.status == "offline" and (.name | startswith($p))) | .id' <<<"$runners" |
      while read -r id; do gh_api DELETE "/$id" || true; done
  fi

  body="$(jq -nc --arg name "$prefix-$(date +%s)" \
    '{name: $name, runner_group_id: 1, labels: ["self-hosted", "linux", "x64", "inwards"]}')"
  if ! jit="$(gh_api POST /generate-jitconfig "$body" | jq -er .encoded_jit_config)"; then
    echo "Could not get a JIT config; retrying in 60 s."
    sleep 60 &
    wait $!
    continue
  fi

  # The JIT config goes in through the environment, not argv, so `ps` on the
  # host doesn't show it. `& wait` lets the TERM trap run while the job runs.
  ACTIONS_RUNNER_INPUT_JITCONFIG="$jit" docker run --rm --name "$container" \
    --env ACTIONS_RUNNER_INPUT_JITCONFIG \
    --memory "${RUNNER_MEMORY:-2g}" --memory-swap "${RUNNER_MEMORY_SWAP:-3g}" \
    --cpus "${RUNNER_CPUS:-2}" --pids-limit 4096 \
    --label inwards-runner="$slot" \
    "$image" /home/runner/run.sh &
  wait $! || echo "Runner container exited with status $?."
done
