# Self-hosted runners for Inwards

Most Linux CI jobs of `SirCypkowskyy/inwards` run on self-hosted runners on
`irysek` (Fedora 44 Server, Intel i5-4570, 4 cores, 7.5 GB RAM), so they use
no GitHub-hosted minutes. Jobs pick them with
`runs-on: [self-hosted, linux, x64, inwards]`: the engine, docs and
ubuntu-26.04 test jobs in `ci.yml`, `bench.yml`, `sarif.yml`, `corpus.yml`,
`docs-links.yml` and the build job of `docs.yml`.

Still on GitHub-hosted runners:

- Jobs that need Docker, publish, or hold a write token, OIDC or a secret,
  because a job here could leak them if the host were compromised:
  `cd.yml` (release builds, Docker for the musl check, attestations),
  `pypi.yml` (Docker action, trusted publishing), `release-please.yml`
  (contents and pull-request write), `docs.yml`'s deploy job (Pages write and
  OIDC), `docs-cloudflare.yml` (Cloudflare secret) and `nightly-e2e.yml`
  (Anthropic secret, issue write).
- `pr-title.yml`: a required check that runs from the base branch, so if these
  runners were down, not even a PR moving jobs back to hosted runners could
  pass it. It takes about a minute.
- The manual rows of `ci.yml`'s test matrix: macOS, Windows and ubuntu-24.04
  (these runners are Ubuntu 26.04, so a 24.04 row here would test nothing new).

`sarif.yml` runs here although it holds `security-events: write`: it is a
per-PR job, and that token can't upload anything while the repository is
private.

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
  a job writes survives into the next one. A container that exits with an
  error delays the next registration by 10 seconds.
- **The token never enters a job container.** `runner.sh` runs on the host,
  holds the PAT from `.env` and hands it to `curl` on stdin, so it doesn't
  show in `ps`. The container only gets the single-use JIT config.
- **Private repositories only.** Before each registration `runner.sh` reads
  the repository and refuses to register while it isn't private.
- **Two slots**, each capped at 2 GB RAM with no swap, 2 CPUs and 4096
  processes, with OOM score 500 so the kernel kills a job before a host
  service. The host has about 3.4 GB free next to its other services.
- **Not privileged**, no host Docker socket, no host mounts. Watchtower is told
  to leave job containers alone.
- **Updates:** GitHub stops queueing jobs to a runner more than 30 days behind
  the latest release, and JIT runners can't update in place. The weekly
  `inwards-runner-build.timer` rebuilds the image with `--pull`, and the next
  job in each slot uses it.
- **Leftovers:** a slot deletes its own offline runners (named
  `irysek-N-<timestamp>`) before it registers a new one.

Docker Compose isn't used: its restart policy restarts the same container,
with the previous job's files still in it.

### Network isolation

Job containers run on their own Docker network, `inwards-ci` (bridge
`br-inwards`, 10.253.0.0/24, inter-container traffic off). The nftables table
`inet inwards_ci` (`inwards-ci.nft`) drops everything from that bridge to the
host itself and to private, CGNAT (tailnet), link-local and multicast
addresses, and all IPv6. Jobs can reach the public internet (GitHub, npm,
PyPI, the corpus repositories) and resolve names through Docker's embedded
DNS; port 53 on private addresses stays open for it.

The table is separate from firewalld's and Docker's, and its chains run
before theirs, so a firewalld reload or a Docker restart doesn't remove it,
and their accept rules can't override its drops. `inwards-runner-network.service`
loads it and creates the network at boot; the slots require that service, so
no job starts without the rules.

Checked on irysek: from `inwards-ci`, `api.github.com` and
`registry.npmjs.org` answer and DNS resolves, while the host's LAN address,
the bridge gateway, `docker0`, other Docker bridges, the LAN router,
`100.100.100.100` and another job container time out. From the default bridge,
all of them answer.

## Install or recreate

On irysek, as `cyprian` (in the `docker` group, passwordless sudo):

```sh
# 1. Files. Copy ops/runner from a checkout of the repo.
sudo install -d -o cyprian -g cyprian /opt/inwards-runner
cp Dockerfile .dockerignore runner.sh inwards-ci.nft .env.example inwards-runner* /opt/inwards-runner/
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

# 4. Services: network and firewall, two slots, the weekly rebuild. They start at boot.
sudo cp /opt/inwards-runner/inwards-runner@.service \
  /opt/inwards-runner/inwards-runner-network.service \
  /opt/inwards-runner/inwards-runner-build.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now inwards-runner-network.service
sudo systemctl enable --now inwards-runner@{1,2}.service inwards-runner-build.timer
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
sudo nft list table inet inwards_ci            # firewall rules
sudo systemctl start inwards-runner-build      # rebuild the image now
sudo systemctl stop 'inwards-runner@*'         # take all slots offline
```

After `systemctl stop`, a running job gets 30 seconds and then fails. To add a
slot, `sudo systemctl enable --now inwards-runner@3.service`; watch memory
first, since two slots already take 4 GB at most.

To rotate the token, edit `.env`. Each slot reads it again before its next job.

To remove everything:

```sh
sudo systemctl disable --now 'inwards-runner@*' inwards-runner-build.timer inwards-runner-network.service
sudo rm /etc/systemd/system/inwards-runner@.service /etc/systemd/system/inwards-runner-*
sudo systemctl daemon-reload
sudo nft delete table inet inwards_ci
docker network rm inwards-ci
docker image rm inwards-runner:latest
sudo rm -r /opt/inwards-runner
```

Offline runners left behind disappear from the repository settings within a
day, or delete them under Settings > Actions > Runners.

## Security

- **Private repository only.** These runners execute pull request code. The
  repository is private and doesn't run workflows from fork pull requests
  (Settings > Actions > General), and `runner.sh` stops registering if the
  repository becomes public. Never turn on fork pull request workflows while
  these runners are attached.
- **Jobs are root inside their container** (sudo, like hosted runners), but the
  container is unprivileged, has no Docker socket, no host mounts and no
  network path to the host or the LAN, and is deleted after the job. A
  container escape would still land on a machine that runs other services.
- **The PAT** can register runners and change the repository's settings
  (Administration: write). It lives only in `/opt/inwards-runner/.env`,
  readable by `cyprian`. Membership of the `docker` group is root on this
  host, and the group has two members, `cyprian` and `kpostek`; either can
  read the token.
- **Other containers on the host hold the Docker socket**, which is root on the
  host: `traefik`, `watchtower`, and another project's runners
  (`pace-github-runner-irysek-*`), which are also privileged. A job on those
  runners, or a compromise of those services, can take over the host, and with
  it these runners and this PAT. Containers on the default bridge and on the
  other Docker networks can reach the host, the LAN and the tailnet.

### Accepted risk

The owner accepted the host risk on 2026-09-26 (#136): PR code from this
private repository runs on irysek, a machine where `traefik`, `watchtower` and
the privileged `pace-github-runner-irysek-*` runners hold the Docker socket,
and where `kpostek` is a second `docker` group member. Any of them can take
over the host and, with it, these runners and the PAT. What limits the damage:
jobs that hold write tokens, OIDC or secrets stay on GitHub-hosted runners;
job containers are unprivileged, deleted after each job and cut off from the
host and the LAN; the PAT covers this one repository.
