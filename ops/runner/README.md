# Self-hosted runners for Inwards

Every Linux CI job of `SirCypkowskyy/inwards` runs on self-hosted runners on
`irysek` (Fedora 44 Server, Intel i5-4570, 4 cores, 7.5 GB RAM), so they use
no GitHub-hosted minutes. Jobs pick them with
`runs-on: [self-hosted, linux, x64, inwards]`.

Still on GitHub-hosted runners:

- `cd.yml`, the whole release pipeline: shipped binaries are built on a clean,
  documented image, not on a home machine other workloads share. The musl
  check needs Docker, and the verify matrix needs arm64, macOS and Windows.
- The manual rows of `ci.yml`'s test matrix: macOS, Windows and ubuntu-24.04
  (these runners are Ubuntu 26.04, so a 24.04 row here would test nothing new).

## How it works

- **Image** (`Dockerfile`): the official runner from
  `ghcr.io/actions/actions-runner:latest`, copied onto `ubuntu:26.04` with
  what the workflows need (git, curl, jq, unzip, xz, zstd, python3, node and
  npx, build-essential, sudo). Bun, uv and CPython 3.14 come from the
  workflows' setup actions at job time. No Docker CLI.
- **One fresh container per job.** Each slot is a systemd service
  (`inwards-runner@N.service`) that loops over `runner.sh`: it asks the API
  for a just-in-time runner config, which is good for exactly one job, runs
  the runner in `docker run --rm`, and starts over when the job ends. Nothing
  a job writes survives into the next one.
- **The token never enters a job container.** `runner.sh` runs on the host and
  holds the PAT from `.env`; the container only gets the single-use JIT
  config.
- **Limits per container:** 2 GB RAM (+1 GB swap), 2 CPUs, 4096 processes.
  Not privileged, no host Docker socket, no host mounts.
- **Updates:** GitHub stops queueing jobs to a runner more than 30 days behind
  the latest release, and JIT runners can't update in place. The weekly
  `inwards-runner-build.timer` rebuilds the image with `--pull`, and the next
  job in each slot uses it.
- **Leftovers:** a slot deletes its own offline runners (named
  `irysek-N-<timestamp>`) before it registers a new one.

Docker Compose isn't used: its restart policy restarts the same container,
with the previous job's files still in it.

## Install or recreate

On irysek, as `cyprian` (in the `docker` group, passwordless sudo):

```sh
# 1. Files. Copy ops/runner from a checkout of the repo.
sudo install -d -o cyprian -g cyprian /opt/inwards-runner
cp Dockerfile runner.sh .env.example inwards-runner* /opt/inwards-runner/
chmod +x /opt/inwards-runner/runner.sh

# 2. Token. Create a fine-grained PAT (Settings > Developer settings >
#    Fine-grained tokens): resource owner SirCypkowskyy, "Only select
#    repositories" > inwards, Repository permissions > Administration:
#    Read and write. Nothing else. Set an expiry and a reminder to rotate it.
cp /opt/inwards-runner/.env.example /opt/inwards-runner/.env
chmod 600 /opt/inwards-runner/.env
$EDITOR /opt/inwards-runner/.env          # GITHUB_PAT=github_pat_...

# 3. Image.
docker build --pull -t inwards-runner:latest /opt/inwards-runner

# 4. Services: three slots and the weekly rebuild. They start at boot.
sudo cp /opt/inwards-runner/inwards-runner@.service \
  /opt/inwards-runner/inwards-runner-build.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now inwards-runner@{1,2,3}.service inwards-runner-build.timer
```

Check that they are online:

```sh
gh api repos/SirCypkowskyy/inwards/actions/runners \
  --jq '.runners[] | [.name, .status, .busy, ([.labels[].name] | join(","))] | @tsv'
```

## Operate

```sh
systemctl status 'inwards-runner@*'           # slots
journalctl -u inwards-runner@1 -f              # one slot's runner log
docker ps --filter label=inwards-runner        # running containers
sudo systemctl start inwards-runner-build      # rebuild the image now
sudo systemctl stop 'inwards-runner@*'         # take all slots offline
```

After `systemctl stop`, a running job gets 30 seconds and then fails. To change
the number of slots, enable or disable `inwards-runner@N.service`; with the
host's 7.5 GB and its other services, three is the ceiling.

To rotate the token, edit `.env`. The slots read it when the next job starts.

To remove everything:

```sh
sudo systemctl disable --now 'inwards-runner@*' inwards-runner-build.timer
sudo rm /etc/systemd/system/inwards-runner@.service /etc/systemd/system/inwards-runner-build.*
sudo systemctl daemon-reload
docker image rm inwards-runner:latest
sudo rm -r /opt/inwards-runner
```

Offline runners left behind disappear from the repository settings within a
day, or delete them under Settings > Actions > Runners.

## Security

- **Private repository only.** These runners execute pull request code. The
  repository is private and doesn't run workflows from fork pull requests
  (Settings > Actions > General). Never attach these runners to a public
  repository, and never turn on fork pull request workflows while they are
  attached.
- **Jobs are root inside their container** (sudo, like hosted runners), but the
  container is unprivileged, has no Docker socket and no host mounts, and is
  deleted after the job. A container escape would still land on a machine
  that runs other services.
- **The PAT** can register runners and change the repository's settings
  (Administration: write). It lives only in `/opt/inwards-runner/.env`,
  readable by `cyprian`; anyone in the `docker` group on irysek is root and can
  read it.
- **Other runners on the same host**: irysek also runs another project's
  runners, which are privileged and mount the host's Docker socket. A job there
  can take over the host, and with it these runners and this PAT.
- **Release builds** don't run here (see above).
