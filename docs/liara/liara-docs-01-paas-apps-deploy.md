# Liara PaaS API — apps, logs, events, deploy, settings, envs, console

Base URL `https://api.liara.ir` · Auth `Authorization: Bearer <API_TOKEN>` · tags: Apps, Deploy, Settings.
Verbatim schemas: `liara-paas-openapi.md`. Mind `{name}` (app name = `project_id`) vs `{id}` (app `_id`).

## Overview (from the official PaaS page)
Create and manage apps (Node.js, Python, Go, PHP, Ruby, .NET, Docker…), scale (on/off), deploy source code (compressed archive) or Docker images, zero-downtime deploys, env vars, metrics, custom domains with SSL, persistent disks with backups.

## Apps

### GET `/v1/projects` — list all apps (`getApps`)
Response 200:
```
{ projects: [ { _id: string,          // app id
                project_id: string,   // app name
                type: string,         // platform
                status: string,
                scale: number,        // 1 = on, 0 = off
                planID: string,
                created_at: string,
                isDeployed: boolean } ] }
```
Errors: 401, 404. **There is no "get one app" endpoint** — filter this list.

### POST `/v1/projects` — create app (`createApp`)
Body (required): `{ name: string, planID: string, platform: string, readOnlyRootFilesystem?: boolean, network?: string }`.
Response 200 (empty). Errors: 400, 401, 409 (conflict, e.g. name taken).

### DELETE `/v1/projects/{name}` — delete app (`deleteAppByName`)
Response 200 "Your request has been submitted." or 204 "App deleted." Errors: 401, 404. Asynchronous.

### POST `/v1/projects/{name}/actions/scale` — turn on/off (`turnApp`)
Body (required): `{ scale: number }` — `1` = on, `0` = off. Response 200 "submitted". Errors: 401, 404. Asynchronous.

### POST `/v1/projects/{name}/actions/restart` — restart (`restartApp`)
No body. Response 200 "submitted". Errors: 401, 404. Asynchronous.

### POST `/v1/projects/{name}/resize` — change plan (`changePlan`)
Body (required): `{ planID: string }`. Response 200. Errors: 400, 401, 404.

### GET `/v1/projects/{name}/logs` — logs (`getAppLogs`)
Query: `since` (**string, required**, "Show logs since timestamp"; format not specified → verify).
Response 200: `[ { type: string, datetime: string, message: string } ]`. Errors: 400, 401, 404. No pagination documented.

### GET `/v1/projects/{name}/events` — events (`getAppEvents`)
Query (all optional): `search` (string), `start` (number, unix seconds, e.g. 1704028315), `end` (number).
Response 200: `{ data: [ { metaData: object, values: [ [string, ...], ... ] } ] }`. Errors: 400, 401, 404.
Meaning of `values` not documented → verify.

## Deploy (v2)

### POST `/v2/projects/{name}/sources` — upload source (`sourcesDeploy`)
`multipart/form-data`, field `file` (binary, required): "The .gz file to deploy" (tar.gz of the project).
Response 200: `{ sourceID: string }`. Errors: 400, 401, 404.

### POST `/v2/projects/{name}/releases` — create release (`releasesDeploy`)
Body (required): `{ sourceID: string, port: number, type: string }` — `type` = platform.
Response 200: `{ releaseID: string }`. Errors: 400, 401, 404.

**NOT PROVIDED:** list releases, release/build status, build logs, rollback.

## Settings (all use `{id}`; `{status}` = `enable` | `disable`)
| Endpoint | operationId | Response |
|---|---|---|
| `POST /v1/projects/{id}/zero-downtime/{status}` | `zeroDowntime` | 200; 400, 401, 404, 409 |
| `POST /v1/projects/{id}/default-subdomain/{status}` | `defaultSubdomain` | 200; 400, 401, 404, 409 |
| `POST /v1/projects/{id}/fixed-ip/{status}` | `ipStatic` | 200 `{ IP: string }`; 400, 401, 404, 409 |
| `POST /v1/projects/{id}/read-only/{status}` | `readOnly` | 200; 400, 401, 404, 409 |

### POST `/v1/projects/update-envs` — update env vars (`updateEnvs`)
Body (required): `{ project: string /* app name */, variables: [ { key: string, value: string } ] }`.
Response 200: `{ message: string }`. Errors: 400, 401, 404.
**NOT PROVIDED:** whether it replaces the whole set or merges; whether it restarts the app. No REST endpoint to read envs → use `liara env:list -a <app> --output json`.

## Console (WebSocket)
`wss://api.liara.ir?token=<api-token>&cmd=/bin/bash&project_id=<project-id>`
Params: `token` (API token), `cmd` (default `/bin/bash`), `project_id` (app id), `teamID` (team services).
⚠️ The token is in the URL — never log it. CLI equivalent: `liara shell -a <app> -c "<cmd>"`.

## Getting started (official)
1. Get an API token from the Liara Console. 2. Create an app. 3. Deploy code or a Docker image. 4. Configure domains and env vars.
