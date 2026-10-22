# Open Questions — Liara / BoxAPI behavior

> Every unknown API behavior gets an `OQ-<n>` id here. Code that depends on it is marked `TODO(OQ-<n>)`.
> Status: ❓ open · 🔎 being investigated · ✅ answered (answer + source)

| ID | Question | Status | Answer / workaround | Source |
|----|----------|--------|---------------------|--------|
| OQ-1 | Log `since` format (unix s / ms / ISO)? | ❓ | Record in T0.5, confirm in T0.8 | — |
| OQ-2 | Metrics `since` semantics (absolute unix vs. seconds-ago)? | ❓ | Record in T0.5, confirm in T0.8 | — |
| OQ-3 | CPU / RAM units in metrics? | ❓ | T0.5 / T0.8 | — |
| OQ-4 | `GET /v1/billing` field names? | 🔎 | `specs/billing.yaml`: `{user:{balance, accountType, minCreditAmount, isManualMinCredit, minCreditLastNotifiedAt}}` — confirm with T0.5 fixture | specs/billing.yaml |
| OQ-5 | `liara plan:list` output structure? | ❓ | T0.5 | — |
| OQ-6 | `events` `values` structure / event types? | ❓ | T0.5 / T0.8. Interim (T1.7): `parseEventRow` takes the first timestamp-like element (s/ms/µs/ns/ISO) as time and the rest as message (JSON object unpacked into `meta`); kind from regex rules over message + metaData; anything else → `unknown` + raw. | — |
| OQ-7 | Possible app `status` values? | ❓ | T0.5 / T0.8 | — |
| OQ-8 | Does `GET /v1/projects/{name}` (app details, incl. `envs`) exist in production? The map says no; `specs/paas.yaml` says yes. | ❓ | Until confirmed: list + filter (G1), env via CLI (G2). If confirmed, it could replace both. Confirm in T0.8 (read-only, safe to check in T0.5). | specs/paas.yaml |
| OQ-9 | Does `GET /v1/projects/{name}/releases` exist? Is `state` usable as the build-finished signal (G5)? Is `sourceAvailable` the rollback feasibility flag (G4)? | ❓ | Until confirmed: local ledger (T1.6). Confirm in T0.8. | specs/paas.yaml |
| OQ-10 | Does `GET /v1/projects/{name}/applets` exist? Do `state`/`reason` expose crash/OOM? | ❓ | Confirm in T0.8. | specs/paas.yaml |
| OQ-11 | Does `GET /v1/domains/{id}/check` exist and trigger/return DNS verification? | ❓ | Confirm in T0.8 / T1.12. | specs/paas.yaml |
| OQ-13 | How is `teamID` sent in REST — query param or header (header name)? | ❓ | `LiaraHttp` defaults to `?teamID=`; `teamIdMode: 'header'` sends a `teamID` header. Flip after T0.8 Q10. | 04-LIARA_API_MAP header |
| OQ-14 | Text format of `liara logs -t` (and `-f`): timestamp position/format, stream marker? | ❓ | `parseCliLogLine` strips ANSI, takes an optional leading ISO timestamp, else keeps raw text with ts=0. Record a real sample in T0.5/T0.8. | — |
| OQ-15 | After `POST /v2/.../releases`, which signal says the build finished and whether it succeeded (events / logs / app status / probe / spec-only releases list `state`)? | ❓ | `DeployApi.waitForRelease` composes caller-supplied `ReleaseSignal`s (any failed → failed, else any success → success, else timeout). Default deploy mode stays CLI (live build log). Answer in T0.8 Q3. | 04-MAP G5 |
| OQ-16 | Exact `liara deploy` output lines per stage (upload/build/push/release/done/failed) and where the version (`v3`) appears; behavior of `--detach`. | ❓ | `cli-parsers.ts#parseDeployLine` uses conservative placeholder regexes; exit code decides done/failed. Record full output in T0.8 Q5. | — |
| OQ-17 | JSON shape of `liara env:list --output json`. | ❓ | `parseEnvListJson` accepts `[{key,value}]`, `[{name,value}]`, `{envs|variables|data:[...]}` and `{KEY:value}`. Record in T0.5. | — |
| OQ-18 | Does the Liara CLI accept the API token from an environment variable (to keep it out of argv / process list)? | ❓ | Currently passed as `--api-token` (as the docs show). | — |
| OQ-19 | `POST /v1/projects/update-envs`: replaces the whole set or merges? Does it restart the app? | ❓ | `EnvApi` default `semantics:'unknown'` → set = read-all→merge→send-all (safe for both); unset = `liara env:unset` (correct for both). `restartsApp:'unknown'`. Answer in T0.8 Q2. | 01-ANALYSIS §8.1, map G3 |
| OQ-20 | Full list of Liara platform ids (`platform` in createApp, `type` in releases, `--platform`) for node, static, react/vue builds, django, flask, fastapi, laravel/php, go, … | ❓ | `PLATFORM_MAP`: `docker`, `next` from Liara CLI docs; `node` from 03-TASKS T0.8 (unverified); the rest `undefined` (never guessed). Record via `liara create --help` in T0.5. | liara-docs-06-cli.md |
| OQ-21 | App working directory inside Liara containers per platform (needed for absolute disk mount paths, e.g. `uploads` → `/<workdir>/uploads`). | ❓ | `detectDeps` returns project-relative folders only; T5.6 must resolve the absolute path once known (check with `liara shell -c pwd` in T0.8). | — |
| OQ-22 | Can `POST /v2/projects/{name}/releases` reuse an older `sourceID` (fast rollback)? For how long are sources kept? (spec-only releases list has `sourceAvailable`) | ❓ | `rollbackApp` `sourceReuse:'unknown'` → tries it, falls back to git worktree → API, then → CLI. Answer in T0.8 Q4. | 01-ANALYSIS §8.3 |
| OQ-12 | Does `GET /v1/databases/{id}` return usable connection info (`hostname, port, username, root_password, dbName`)? | ❓ | If yes, closes G7 (no human copy step). Confirm in T0.5/T0.8. | specs/dbaas.yaml |
