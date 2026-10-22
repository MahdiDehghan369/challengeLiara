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
| OQ-6 | `events` `values` structure / event types? | ❓ | T0.5 / T0.8 | — |
| OQ-7 | Possible app `status` values? | ❓ | T0.5 / T0.8 | — |
| OQ-8 | Does `GET /v1/projects/{name}` (app details, incl. `envs`) exist in production? The map says no; `specs/paas.yaml` says yes. | ❓ | Until confirmed: list + filter (G1), env via CLI (G2). If confirmed, it could replace both. Confirm in T0.8 (read-only, safe to check in T0.5). | specs/paas.yaml |
| OQ-9 | Does `GET /v1/projects/{name}/releases` exist? Is `state` usable as the build-finished signal (G5)? Is `sourceAvailable` the rollback feasibility flag (G4)? | ❓ | Until confirmed: local ledger (T1.6). Confirm in T0.8. | specs/paas.yaml |
| OQ-10 | Does `GET /v1/projects/{name}/applets` exist? Do `state`/`reason` expose crash/OOM? | ❓ | Confirm in T0.8. | specs/paas.yaml |
| OQ-11 | Does `GET /v1/domains/{id}/check` exist and trigger/return DNS verification? | ❓ | Confirm in T0.8 / T1.12. | specs/paas.yaml |
| OQ-13 | How is `teamID` sent in REST — query param or header (header name)? | ❓ | `LiaraHttp` defaults to `?teamID=`; `teamIdMode: 'header'` sends a `teamID` header. Flip after T0.8 Q10. | 04-LIARA_API_MAP header |
| OQ-14 | Text format of `liara logs -t` (and `-f`): timestamp position/format, stream marker? | ❓ | `parseCliLogLine` strips ANSI, takes an optional leading ISO timestamp, else keeps raw text with ts=0. Record a real sample in T0.5/T0.8. | — |
| OQ-12 | Does `GET /v1/databases/{id}` return usable connection info (`hostname, port, username, root_password, dbName`)? | ❓ | If yes, closes G7 (no human copy step). Confirm in T0.5/T0.8. | specs/dbaas.yaml |
