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
network="${RUNNER_NETWORK:-inwards-ci}"
memory="${RUNNER_MEMORY:-2g}"
prefix="${RUNNER_NAME_PREFIX:-$(hostname -s)}-$slot"
container="inwards-runner-$slot"

if [[ -z "${GITHUB_PAT:-}" ]]; then
  echo "GITHUB_PAT is not set in $here/.env; see README.md. Retrying in 5 minutes."
  sleep 300
  exit 1
fi

# Calls the repository's API: gh_api METHOD PATH [JSON_BODY], PATH relative to
# /repos/<repo>. The token goes to curl on stdin, so `ps` never shows it.
gh_api() {
  printf 'Authorization: Bearer %s\n' "$GITHUB_PAT" |
    curl -fsS -X "$1" -H @- \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "https://api.github.com/repos/$repo$2" ${3:+--data "$3"}
}

# Waits without blocking the TERM trap: pause SECONDS.
pause() {
  sleep "$1" &
  wait $!
}

# systemctl stop: let the runner finish its shutdown, then leave.
trap 'docker stop -t 30 "$container" >/dev/null 2>&1 || true; exit 0' TERM INT

while true; do
  load_env
  docker rm -f "$container" >/dev/null 2>&1 || true

  # These runners execute pull request code: never register one for a
  # repository anyone can open a pull request against.
  if ! private="$(gh_api GET "" | jq -r .private)"; then
    echo "Could not read $repo; retrying in 60 s."
    pause 60
    continue
  fi
  if [[ "$private" != "true" ]]; then
    echo "$repo is not private; refusing to register a runner. Retrying in 5 minutes."
    pause 300
    continue
  fi

  # A runner that never picked up a job (reboot, crash) stays registered as
  # offline. Remove this slot's leftovers before registering a new one.
  if runners="$(gh_api GET "/actions/runners?per_page=100")"; then
    jq -r --arg p "$prefix-" \
      '.runners[] | select(.status == "offline" and (.name | startswith($p))) | .id' <<<"$runners" |
      while read -r id; do gh_api DELETE "/actions/runners/$id" || true; done
  fi

  body="$(jq -nc --arg name "$prefix-$(date +%s)" \
    '{name: $name, runner_group_id: 1, labels: ["self-hosted", "linux", "x64", "inwards"]}')"
  if ! jit="$(gh_api POST /actions/runners/generate-jitconfig "$body" | jq -er .encoded_jit_config)"; then
    echo "Could not get a JIT config; retrying in 60 s."
    pause 60
    continue
  fi

  # The JIT config goes in through the environment, not argv, so `ps` on the
  # host doesn't show it. `& wait` lets the TERM trap run while the job runs.
  # No swap, and the kernel's OOM killer picks a job before a host service.
  status=0
  ACTIONS_RUNNER_INPUT_JITCONFIG="$jit" docker run --rm --name "$container" \
    --env ACTIONS_RUNNER_INPUT_JITCONFIG \
    --network "$network" \
    --memory "$memory" --memory-swap "$memory" --oom-score-adj 500 \
    --cpus "${RUNNER_CPUS:-2}" --pids-limit 4096 \
    --label inwards-runner="$slot" \
    --label com.centurylinklabs.watchtower.enable=false \
    "$image" /home/runner/run.sh &
  wait $! || status=$?
  if ((status != 0)); then
    echo "Runner container exited with status $status; waiting 10 s."
    pause 10
  fi
done
