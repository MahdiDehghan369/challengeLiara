# Liara endpoints (machine-checkable list)

> Built row-by-row from `04-LIARA_API_MAP.md` §2 and §3 (T0.1). `04-LIARA_API_MAP.md` stays the source of truth.
> `scripts/fetch-specs.ts` parses the REST table below (`| METHOD | /path |`) and diffs it against `specs/paas.yaml` → `SPEC_DIFF.md`.
> Source column: `map` = listed in the map · `spec-only` = found only in `specs/paas.yaml` (not yet confirmed by spike).
> Key: `{name}` = app name (`project_id`), `{id}` = internal id (`_id`) → always via `resolveApp(name)`.

Base: `https://api.liara.ir` · Auth: `Authorization: Bearer <API_TOKEN>`.

## REST

| Method | Path | Key | Group | Async | Source | Notes |
|---|---|---|---|---|---|---|
| GET | /v1/projects | — | apps | | map | List apps. No app-details endpoint → list + filter by `project_id`. |
| POST | /v1/projects | — | apps | | map | Create app `{name, planID, platform, readOnlyRootFilesystem?, network?}`; 409 = duplicate name. |
| DELETE | /v1/projects/{name} | name | apps | yes | map | 200 "accepted" / 204 → poll until gone from list. |
| POST | /v1/projects/{name}/actions/scale | name | apps | yes | map | `{scale: 1 \| 0}`. |
| POST | /v1/projects/{name}/actions/restart | name | apps | yes | map | |
| POST | /v1/projects/{name}/resize | name | apps | | map | `{planID}`. |
| GET | /v1/projects/{name}/logs | name | logs | | map | `since` required (string); `[{type, datetime, message}]`; no paging. |
| GET | /v1/projects/{name}/events | name | events | | map | `search`, `start`, `end` (unix s) → `{data:[{metaData, values:[[string]]}]}`. |
| POST | /v2/projects/{name}/sources | name | deploy | | map | multipart `file` (.tar.gz) → `{sourceID}`. |
| POST | /v2/projects/{name}/releases | name | deploy | | map | `{sourceID, port, type}` → `{releaseID}`. |
| POST | /v1/projects/{id}/zero-downtime/{status} | id | settings | | map | `status` = enable \| disable; 200 / 409. |
| POST | /v1/projects/{id}/default-subdomain/{status} | id | settings | | map | 200 / 409. |
| POST | /v1/projects/{id}/fixed-ip/{status} | id | settings | | map | → `{IP}`. |
| POST | /v1/projects/{id}/read-only/{status} | id | settings | | map | 200 / 409. |
| POST | /v1/projects/update-envs | — | env | | map | `{project:<name>, variables:[{key, value}]}` → `{message}`. Replace vs merge unknown → always read-all → merge → send-all. |
| GET | /v1/projects/{name}/metrics/summary | name | metrics | | map | `{cpuUsage, memoryUsage, disksUsage}`. |
| GET | /v1/projects/{name}/metrics/cpu | name | metrics | | map | `since` (number, required) → `{end, result:[{values:[[ts,v]], applet}]}`. |
| GET | /v1/projects/{name}/metrics/memory | name | metrics | | map | same shape. |
| GET | /v1/projects/{name}/metrics/network-receive | name | metrics | | map | same shape. |
| GET | /v1/projects/{name}/metrics/network-transmit | name | metrics | | map | same shape. |
| GET | /v1/projects/{id}/disks | id | disks | | map | `{disks:[...], mounts:[{name, mountedTo}]}`. |
| POST | /v1/projects/{name}/disks | name | disks | | map | `{name, size: string}` → 201. |
| POST | /v1/projects/{name}/disks/{dname}/resize | name | disks | | map | `{size: string}`. |
| DELETE | /v1/projects/{id}/disks/{name} | id | disks | | map | 200 / 409. |
| GET | /v1/projects/{id}/disks/{name}/backups | id | backups | | map | `{backups:[{name,lastModified,etag,size}]}`. |
| POST | /v1/projects/{id}/disks/{name}/backups | id | backups | | map | Create backup. |
| POST | /v1/projects/{id}/disks/{dname}/backups/{bname}/download | id | backups | | map | → `{link}`. |
| GET | /v1/projects/{name}/disks/{dname}/ftp | name | ftp | | map | ⚠️ response contains passwords → redact. |
| POST | /v1/projects/{name}/disks/{dname}/ftp | name | ftp | | map | `{username, readOnly}` → `{username, password, host}` ⚠️. |
| DELETE | /v1/ftp/{fname} | — | ftp | | map | |
| GET | /v1/domains | — | domains | | map | `?project=<name>` → `{domains:[...]}` incl. `CNameRecord`, `certificatesStatus`. |
| POST | /v1/domains | — | domains | | map | `{name, project, type:"PROJECT"}` → 201 `{domain:{_id}}` / 409. |
| POST | /v1/domains/set-project | — | domains | | map | `{domainID, projectID}`. |
| POST | /v1/domains/{id}/set-redirect | id | domains | | map | `{redirectStatus: 301\|302, redirectTo}`. |
| POST | /v1/domains/provision-ssl-certs | — | ssl | | map | `{domain}` → `{code}`. |
| POST | /v1/domains/{id}/ssl/disable | id | ssl | | map | 204. |
| DELETE | /v1/domains/{id} | id | domains | | map | |
| GET | /v1/billing | — | billing | | map | Balance (Toman), account type, alert threshold… Defined in `specs/billing.yaml`: `{user:{balance, accountType, minCreditAmount, isManualMinCredit, minCreditLastNotifiedAt}}` (confirm with T0.5 fixture). |
| GET | /v1/projects/{name} | name | apps | | spec-only | **App details** incl. `envs[{key,value,encrypted}]`, `status`, `isDeployed`, `planID`, `defaultSubdomain`, `zeroDowntime`, `hourlyPrice`. Map says it does not exist → confirm in T0.8 (OQ-8). Until then use list + filter. |
| GET | /v1/projects/{name}/releases | name | releases | | spec-only | **Release list**: `{total, currentRelease, readyReleasesCount, releases:[{_id, state, port, gitInfo, finishedAt, createdAt, tag, sourceAvailable}], platform}`. Confirm in T0.8 (OQ-9). Until then the local ledger is the source. |
| GET | /v1/projects/{name}/applets | name | apps | | spec-only | `{applets:[{id, name, timestamp, state, reason, release:{releaseID, tag}}]}`. Confirm in T0.8 (OQ-10). |
| GET | /v1/domains/{id}/check | id | domains | | spec-only | Domain check: `{domain:{status, certificatesStatus, CNameRecord, verificationCode, ...}}`. Confirm in T0.8 (OQ-11). |

## Other specs (spec-only, from `specs/dbaas.yaml`, `specs/me.yaml`)

| Method | Path | Key | Group | Async | Source | Notes |
|---|---|---|---|---|---|---|
| POST | /v1/databases | — | dbaas | | spec-only | Create `{hostname, type, planID, version, publicNetwork, options}` → `{databaseID}`. |
| GET | /v1/databases | — | dbaas | | spec-only | `{databases:[{DBId, id, type, planID, status, scale, hostname, publicNetwork, internalPort, created_at}]}`. |
| GET | /v1/databases/{id} | id | dbaas | | spec-only | Details incl. **connection info**: `hostname, port, internalPort, username, root_password, dbName, node.host` ⚠️ contains password → redact. Closes gap G7 if confirmed (OQ-12). |
| POST | /v1/databases/{id}/actions/scale | id | dbaas | yes? | spec-only | Power on/off `{scale}`. |
| POST | /v1/databases/{id}/resize | id | dbaas | | spec-only | `{planID, disk}`. |
| DELETE | /v1/databases/{id} | id | dbaas | | spec-only | |
| GET | /v1/me | — | account | | spec-only | `{user, team, plans, ...}` — `user.storage.secretKey` / `accessKey` ⚠️ secrets → never log; `team.balance`. |

## WebSocket

| URL | Notes |
|---|---|
| `wss://api.liara.ir?token=<token>&cmd=/bin/bash&project_id=<id>` (+ `teamID`) | Console. ⚠️ token in URL → never log the URL. CLI equivalent: `liara shell -a <app> -c "<cmd>"`. |

## CLI only

| Need | Command |
|---|---|
| Plan catalog and prices | `liara plan:list` (output format → T0.5) |
| Read envs | `liara env:list -a <app> --output json` |
| Unset env (if update-envs merges) | `liara env:unset KEY -a <app> -f` |
| Databases | `liara db create -n -t -v --plan --feature-plan -y`, `db list --output json`, `db resize`, `db start/stop`, `db remove -y` |
| Deploy with live build log | `liara deploy -a --path --port --platform -m --detach --no-app-logs -b iran\|germany` |
| Live logs | `liara logs -a -f -t -s "1 hour ago" -r <version>` |
| Run a command in the container | `liara shell -a -c` |
| Liara DNS | `liara zone create/check/get/list/delete` |

All CLI commands run with `--api-token` and, when needed, `--team-id`.

## Does NOT exist (per the map — do not implement)
App details · release list · release/build status · build logs via REST · rollback · reading envs via REST · plan catalog via REST.
