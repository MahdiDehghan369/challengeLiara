# Liara CLI (`@liara/cli`) — command reference

## Install & check
Requires Node.js + npm (install the latest Node LTS from nodejs.org).
```bash
npm install -g @liara/cli      # install; run the same command to upgrade
liara -v                       # check version
```
If you get `command not found` / `is not recognized`, prefix commands with npx:
```bash
npx liara login        npx liara deploy
npx @liara/cli login   npx @liara/cli deploy
```
Autocomplete: `liara autocomplete`.

## Flags shared by (almost) every command
| Flag | Meaning |
|---|---|
| `-h`, `--help` | show help |
| `--debug` | debug logs |
| `--api-token <value>` | run immediately with an API token, no login (good for CI/CD and agents) |
| `--account <value>` | temporarily use another saved account |
| `--team-id <value>` | select a team by id |
| `-a`, `--app <name>` | target app (most app commands) |

List commands (`app:list`, `env:list`, `db list`, `bucket list`, `zone list`, `zone get`) also take: `-x/--extended`, `--columns <a,b>`, `--filter "name=value"`, `--no-header`, `--csv`, `--no-truncate`, `--output csv|json|yaml`, `--sort <col>` (prefix `-` for descending).

---

## Account
| Command | Syntax / flags | Purpose |
|---|---|---|
| `liara login` | `[-e <email>] [-p <password>] [-i/--interactive] [--api-token <v>] [--account <v>] [--browser chrome\|firefox\|edge]` | log in (browser by default; `-i` = user/password; `--api-token` for CI) |
| `liara account:add` | `[-a <name>] [-e <email>] [-p <password>] [--api-token <v>]` | add an account |
| `liara account:remove` (`account:rm`) | `[-a <name>] [--team-id <v>] [--api-token <v>]` | remove an account |
| `liara account:use` | `[-a <name>] [--team-id <v>] [--api-token <v>]` | set default account |

Deploying to a specific account: put `{ "account": "account_name" }` in `liara.json` at the project root.

## Plans
| Command | Purpose |
|---|---|
| `liara plan:list` | list service plans (**source for the plan catalog**; output format not shown in the docs — try `--output json`) |

## Project config
`liara init` — creates `liara.json` in the project root.
`liara init [-y] [-n <app>] [-p <port>] [-P <platform>] [-v <platform version>] [--build-location <loc>] [-d <disk> --path <path>] [--team-id <v>] [--account <v>] [--api-token <v>]`
Examples: `liara init -y` (default template), `-n mynode-app`, `-p 3005`, `-P next`, `-v 22`, `--build-location=germany`, `-d data --path /path/to/data`.

## Apps
| Command | Syntax | Notes |
|---|---|---|
| `liara create` (`app:create`) | `[-a/--app <name>] [--platform <p>] [--plan <plan>] [--feature-plan <fp>] [-n/--network <net>] [-r/--read-only true\|false] [--team-id] [--account] [--api-token]` | examples: `--app=my-web-app`, `--plan=free`, `--feature-plan=free`, `--platform=docker`, `-n liara-net`, `-r true` |
| `liara delete` (`app:delete`, `app remove`, `app rm`) | `[-a/--app <name>]` | |
| `liara app:list` (`app:ls`) | list flags above | e.g. `--output=json`, `--filter="name=myapp"` |
| `liara restart` (`app:restart`) | `[-a <name>]` | |
| `liara start` (`app:start`) / `liara stop` (`app:stop`) | `[-a <name>]` | turn app on / off |
| `liara shell` (`app:shell`) | `[-a <name>] [-c/--command <cmd>]` | example `--command=/bin/sh` |
| `liara logs` (`app:logs`) | `[-a <name>] [-s/--since <value>] [-t/--timestamps] [-f/--follow] [-c/--colorize] [-r/--release <version>]` | examples: `--since="1 hour ago"`, `-r v2`, `--follow` for real-time |

## Deploy
`liara deploy [-a/--app <name>] [--path <dir>] [--platform <p>] [-p/--port <n>] [-i/--image <docker image>] [-d/--disks <disk=/path>...] [--detach] [--no-app-logs] [--no-cache] [-m/--message <text>] [-f/--dockerfile <path>] [-b/--build-location iran|germany] [--args <entrypoint args>] [--build-arg <K=V>...] [--liara-json <file>] [--team-id] [--account] [--api-token]`

| Flag | Meaning / example |
|---|---|
| `--app` | target app id |
| `--path` | project root |
| `--platform` | e.g. `docker` |
| `--port` | port the app listens on, e.g. `3000` |
| `-i, --image` | deploy a Docker Hub image directly, e.g. `nextcloud:1.23` |
| `-d, --disks` | attach disks, e.g. `-d data=/var/www/html` |
| `--detach` | don't stream logs after deploy |
| `--no-app-logs` | don't show app logs after deploy |
| `--no-cache` | don't use the previous version's cache |
| `-m, --message` | message for the deployment |
| `-f, --dockerfile` | custom Dockerfile name/path |
| `-b, --build-location` | `iran` or `germany` |
| `--args` | entrypoint args of a Docker image |
| `--build-arg` | build args, e.g. `APP_VERSION=2.0.0` |
| `--liara-json` | alternate JSON file instead of `liara.json` |

## Environment variables
| Command | Syntax |
|---|---|
| `liara env:list` (`env:ls`) | `[-a <app>]` + list flags (`--output json`) |
| `liara env:set` | `liara env set [ENV...] [-a <app>] [-f/--force]` (force = no confirmation) |
| `liara env:unset` | `liara env unset [ENV...] [-a <app>] [-f/--force]` |

## Disks
`liara disk` (shows disk commands) · `liara disk:create [-a <app>] [-n <disk name>] [-s <size in GB>]` (asks interactively if omitted).

## Databases
| Command | Syntax |
|---|---|
| `liara db create` | `[-n/--name <n>] [--plan <plan>] [--feature-plan <fp>] [-t/--type <mysql…>] [-v/--version <v>] [--public-network] [--network <net>] [-y]` |
| `liara db remove` (`db rm`) | `[-n <name>] [-y]` |
| `liara db list` (`db ls`) | list flags |
| `liara db resize` | `[-n <name>] [--plan <plan>] [-d <y>]` (d = confirm disk increase) |
| `liara db start` / `liara db stop` | `[-n <name>]` |

## Object storage buckets
| Command | Syntax |
|---|---|
| `liara bucket create` | `[--name <n>] [--permission private\|public] [--plan <plan>]` |
| `liara bucket delete` | `[-b/--bucket <name>] [-f/--force]` |
| `liara bucket list` (`bucket ls`) | list flags |

## Domains on Liara DNS ("zone")
| Command | Syntax | Purpose |
|---|---|---|
| `liara zone create` | `[-z/--zone <domain>]` | create a DNS management zone for the domain |
| `liara zone delete` (`zone del`, `zone rm`) | `[-z <domain>] [-y]` | remove the zone |
| `liara zone check` (`zone ch`) | `[-z <domain>]` | verify the Liara nameservers are correctly set at the registrar |
| `liara zone get` | `[-z <domain>]` + list flags | zone details |
| `liara zone list` (`zone ls`) | list flags | list zones |

---

## Quirks in the source docs (don't copy blindly)
- Some examples are copy-paste errors: `liara restart -e email@example.com`, `liara disk:create --debug` under other commands, `liara db start`/`stop` examples written as `db create`, `bucket delete` usage line printed as `liara db remove`.
- `liara plan:list` output format, platform identifier list and `--feature-plan` values are **not enumerated** — capture them with real runs (`liara create --help`, `liara plan:list`).
