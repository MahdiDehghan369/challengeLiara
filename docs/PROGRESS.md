# PROGRESS — siavash-agent

> Persistent state for the build. A fresh session resumes from this file alone.
> Statuses: ⬜ not started · 🚧 in progress · ✅ done · ⛔ blocked (reason in Notes)

## Resume here
- **Current task:** —
- **Next (critical path):** see "Order" below; first ⬜ whose dependencies are ✅.

## Environment (local machine)
- Node 22 (portable): `%LOCALAPPDATA%\Programs\node-v22.23.4-win-x64`; MinGit: `%LOCALAPPDATA%\Programs\MinGit\cmd`. Both were added to the *user* PATH, but already-running shells (incl. the agent's) need:
  `$env:Path="$env:LOCALAPPDATA\Programs\node-v22.23.4-win-x64;$env:LOCALAPPDATA\Programs\MinGit\cmd;$env:Path"`
- pnpm 12.15.0 via corepack (`corepack enable pnpm`). esbuild build script approved in `pnpm-workspace.yaml` (`allowBuilds`).
- Git identity is repo-local (`git config user.name/user.email`).

## Order
1. MVP critical path: T0.3 → T0.4 → T0.1 → T0.2 → T0.5 → T0.8 → T1.1–T1.6, T1.8, T1.10, T1.11, T1.13, T1.14, T1.16, T1.17 → T2.1–T2.4 → T3.1–T3.6 → T4.1–T4.7 → T5.1–T5.8, T5.10 → T6.1, T6.2, T6.4, T6.5 → T7.1–T7.6 → T8.1–T8.13 → T5.11 → T8.14, T8.15 → T9.1–T9.6, T9.8 → T10.4, T10.5 → T11.1–T11.3, T11.7–T11.10
2. After MVP: T11.11 → T7.9 → T4.8 → T8.16 → T9.10 → T6.9
3. Then all remaining tasks in numeric order.

## Tasks

| Task | Status | Commit | Notes |
|------|--------|--------|-------|
| T0.1 | ✅ | e488163 | Team docs were already in docs/liara/. All 5 specs + 2 pages downloaded to specs/. paas.yaml: 41 ops; 4 **spec-only**: app details `GET /v1/projects/{name}` (incl. envs), release list `GET /v1/projects/{name}/releases` (state, sourceAvailable), applets, domain check → OQ-8..OQ-11. dbaas.yaml has DB connection details (OQ-12, may close G7). billing.yaml gives billing field names (OQ-4). Re-run offline: `pnpm tsx scripts/fetch-specs.ts --offline`. |
| T0.2 | ⛔ | (script: see git log `T0.2:`) | **Blocked: needs `BOXAPI_API_KEY` in `.env`** (user chose to skip for now on 2026-10-22). `scripts/llm-smoke.ts` is written, typechecks and lints. When the key exists: `pnpm tsx scripts/llm-smoke.ts` → writes docs/LLM_COMPAT.md + config/models.json (role picking is automatic; review it). Blocks T3.1. |
| T0.3 | ✅ | 5fbd061 | Skeleton per 01-ANALYSIS §3. tsc build (rootDir src → dist), NodeNext ESM (imports use `.js`). ESLint 8.57 + `.eslintrc.cjs`; vitest forces LIARA_MODE/LLM_MODE=mock; e2e via `vitest.e2e.config.ts`. Also committed the planning docs and the user's README.md deletion. |
| T0.4 | ✅ | b147f50 | zod 4, pino 9, dotenv 17. Config exposed as `getConfig()` (memoized, loads .env) + pure `loadConfig(env)` — see D-004. Logger: pino `redact` paths + deep case-insensitive key scrub + `token=` URL scrub in objects and messages. Seed `src/ui/cli/i18n/fa.ts` created (T9.1 expands). `config/models.json` schema: `{baseUrl, roles:{chat,reasoning,code,cheap:{model,fallbackProtocol,fallbacks[]}}}`. |
| T0.5 | ⬜ | - | ⚠️ needs LIARA_API_TOKEN |
| T0.6 | ✅ | d98d917 | Done ahead of T1.x per TASKS "day one" order (T0.8 depends on it). Express 5 app with npm lockfile (Liara builds with npm). Verified on Windows: `PORT=3999 node index.js` → `/health` 200, `/api/items` OK. `scripts/check-demo-apps.sh` needs bash (not on this machine; runs in CI/Linux). |
| T0.7 | ✅ | 44a99d8 | GitHub Actions: Node 22, pnpm via corepack (`packageManager` pin), install --frozen-lockfile → typecheck → lint → test with LIARA_MODE/LLM_MODE=mock. No secrets. Not yet observed running on GitHub (nothing pushed). |
| T0.8 | ⬜ | - | ⚠️ needs LIARA_API_TOKEN + human confirmation for each change |
| T1.1 | ✅ | b58085a | `LiaraHttp` (native fetch): get/post/delete with query/body/multipart/schema; 20s / 10min (multipart) timeouts; GET-only retry (429/502/503/504/network/timeout, max 3, Retry-After honored, exp backoff + jitter); empty 200/204 → `{accepted:true}`; status → code + Persian message; `getStats()`. 429 → `RateLimitError` (D-007). `LiaraApiError` now takes `code` + `operationId`. teamID transport → OQ-13. msw postinstall denied in pnpm-workspace.yaml (browser worker only). |
| T1.2 | ✅ | 0f336cb | `AppsApi` (list w/ 5s cache + `fresh`, find/get/resolve with Levenshtein suggestion → `APP_NOT_FOUND`, create (409 → `APP_NAME_TAKEN`), delete/scale/restart/resize → `{accepted:true}`, cache invalidated on mutation). `wait.ts`: `waitForState` (`WAIT_TIMEOUT` with last value), `waitAppGone`, `waitAppScale`, `waitAppRunning` (scale=1 ∧ isDeployed≠false ∧ optional probe; status strings TODO(OQ-7)). Tests use **spec-derived synthetic fixtures** in `fixtures/liara/spec/` (loader prefers recorded ones). New guard test: `tests/unit/liara/endpoints-guard.test.ts` fails if `src/liara/api` uses a path that is not a `map` row of ENDPOINTS.md. |
| T1.3 | ✅ | 918944d | `MetricsApi.getSummary` → `{cpu:[{applet,value,ts}], memory, disks:[{name,sizeRaw,usageRaw,reportedAt}]}` (summary `value` is an array per spec; treated as `[ts, value]`, last element = value). `getSeries(name, kind, windowSec)` → `{kind, unit, series:[{applet,points}], dropped, end}`; `since` encoded inside via `sinceMode` (default 'absolute' = now−window; TODO(OQ-2)); `unit: 'unknown'` (TODO(OQ-3)). 2 `it.todo` for OQ-2/OQ-3. "Parse real fixtures" acceptance is pending T0.5 (synthetic spec fixtures used). Guard test now matches `{}` segment-wise. |
| T1.4 | ✅ | 1a22af9 | `LogsApi.getLogs` (`since` via `sinceFormat` unix-s default / unix-ms / iso, TODO(OQ-1)) → `LogLine {ts(ms), stream, text, source}`; `tailLogs` AsyncIterable (since=last ts, sha1 dedupe bounded 5000, AbortSignal); `followLogs` / `getLogsByRelease` via a `LogsCli` interface (`run`, `streamLines`) that T1.14 must implement; `parseCliLogLine` tolerant (OQ-14). Same `LogLine` type for API and CLI (test). |
| T1.5 | ✅ | f703fdf | `archive.ts`: own minimal gitignore matcher (no extra lib), `.liaraignore` > `.gitignore`, always drops node_modules/.git/.siavash/.env* (keeps .env.example); tar.gz via `tar` → `{path, sizeBytes, fileCount, sha256, files, ignoreSource, warnings}` (>200MB → ARCHIVE_TOO_LARGE). `DeployApi`: `uploadSource` streams a hand-built multipart body (new `LiaraHttp` `rawBody` option, duplex 'half') with % progress; `createRelease`; `waitForRelease` composes pluggable `ReleaseSignal`s (TODO(OQ-15)). |
| T1.6 | ✅ | 6fa74af | `DeploymentLedger` JSONL at `${dataDir}/ledger/<app>.jsonl` + copy in `<project>/.siavash/deployments.jsonl`. Append-only: `update` appends a full snapshot; last line per id wins. Corrupt lines skipped + reported (`onCorruptLine` + pino warn). `record/update/list/latest/previousHealthy/findByCommit`; record also has `rollbackOf?` and result `pending`. `previousHealthy` = last `success` before latest (or before a given id); T7.6 verdicts may refine. |
| T1.7 | ⬜ | - | |
| T1.8 | ✅ | c3f3715 | `EnvApi(http, cli, {semantics})`: listEnv via CLI (Secret values); setEnv: replace/unknown → read-all→merge→send-all, merge → only new; unsetEnv: replace → send-without, merge/unknown → `env:unset` (D-009). Result `{before, after (re-read), diff, restartsApp:'unknown'}` (deviation: spec says boolean; 'unknown' until OQ-19). Only keys are logged. Matrix test (client unknown×server replace/merge, etc.) proves no env is lost. |
| T1.9 | ⬜ | - | |
| T1.10 | ⬜ | - | |
| T1.11 | ✅ | 9bdf026 | `DisksApi` per map: `{id}` (via resolveApp) for list/delete disk + all backups; `{name}` for create/resize disk + FTP list/create; `/v1/ftp/{fname}` delete. 409 on delete → `DISK_IN_USE`. Sizes sent as strings. New `src/shared/secret.ts` (`Secret<T>`: toString/toJSON/inspect/toPrimitive → `[SECRET]`, `reveal()`, `maskSecret`). FTP passwords and the backup download link (likely pre-signed URL) are `Secret`. Logger's deep scrub now serializes via `toJSON` (Secret/Date). Tests prove `{id}`/`{name}` per path via msw request log. |
| T1.12 | ⬜ | - | |
| T1.13 | ✅ | 6868753 | `DbApi(cli, http)`: create (publicNetwork default false)/list(raw)/start/stop/resize/remove via CLI. `getDbConnection(name)` uses spec-only dbaas `GET /v1/databases` (match `hostname`) → `GET /v1/databases/{id}`; internal `{hostname, internalPort}`, public `{node.host, port}` only if publicNetwork; password + connection string as `Secret`; any failure → `{status:'needs-human', instructionFa}` (TODO(OQ-12)). `buildConnectionString` postgres/mysql/mariadb/mongodb with URL-encoded creds. |
| T1.14 | ✅ | 4720aae | `LiaraCli` over an injectable `Spawner` (default execa 9, `reject:false`, merged lines via `iterable({from:'all'})`). Always appends `--api-token`/`--team-id`; `scrub()` removes the token from logged args, streamed lines, stdout and errors (logger-spy test). Non-zero exit/timeout → `ExternalCommandError` with last 50 lines. `ensureCli` (liara → `npx -y @liara/cli` → not installed + Persian hint). Commands: planList (raw, OQ-5), envList (→ Secret, OQ-17), envUnset, db create/list/start/stop/resize(-d y)/remove (flags per docs: `db stop` has no -y), logs, shell, zoneCheck, deploy (events; placeholder stage regexes OQ-16; 15 min timeout). Implements `LogsCli` for T1.4. OQ-18: token is visible in argv. |
| T1.15 | ⬜ | - | |
| T1.16 | ⬜ | - | |
| T1.17 | ⬜ | - | |
| T2.1 | ✅ | e801ad9 | `Risk` numeric enum, `ActionPlan` (+ `escalations` codes), `escalate(plan, {productionApps, protectedApps, envSemantics})` never lowers risk: stop/scale=0 on production|protected → R3; secret-like env keys (`*_KEY, *_SECRET, *PASSWORD*, *TOKEN*, DATABASE_URL, *_URI`) → ≥R2; replace semantics + removed vars (`params.removedCount` or unset keys) → R3; fixed-ip enable → R2. Tool names fixed in `RISK_TOOLS` (stop_app, scale_app, set_env, unset_env, set_fixed_ip) — the registry must reuse them. |
| T2.2 | ✅ | 4d9f8bd | `Approver.request(plan, ctx?)` → `approved \| approved-session \| denied \| {edited} \| {pending:{token,expiresAt}}` (extended for session + MCP two-step). Approvers: `AutoDenyApprover`, `YesApprover` (R1 only; enforces "--yes never approves R2/R3"), `ScriptedApprover`, `McpApprover` (5-min single-use token bound to sha256 of tool+target+params, key-order independent). `guard(plan, approver, exec, {dryRun, audit, session, confirmToken, reassess, actor, sessionId})`: R0 direct; R1+ approver; session approval only R1 per tool+app; edited params re-assessed (higher risk → ask again, never lowered); dry-run; every path calls `AuditSink.record` (T2.4 implements). `CliApprover` is T9.5. |
| T2.3 | ✅ | (see git log `T2.3:`) | `Secret<T>` already from T1.11 (src/shared/secret.ts). `src/safety/redact.ts`: `Redactor` (rules: PEM keys, Bearer/Basic, JWT, sk-/rk-/pk- keys, GitHub, AWS AKIA, Slack, `scheme://user:pass@` → `user:***@`, secret query params incl. `?token=`, secret-named KEY=/KEY: assignments; plus session-known secret values ≥6 chars via `addKnownSecret`), `redactObject` recursive (sensitive keys, Secret → [SECRET], Date kept, input not mutated). `defaultRedactor` + `redactText/redactObject`. 23 secret samples hidden; 10 normal texts untouched. Must be used before sending logs/code to an LLM. |
| T2.4 | ⬜ | - | |
| T2.5 | ⬜ | - | |
| T2.6 | ⬜ | - | |
| T3.1 | ⬜ | - | |
| T3.2 | ⬜ | - | |
| T3.3 | ⬜ | - | |
| T3.4 | ⬜ | - | |
| T3.5 | ⬜ | - | |
| T3.6 | ⬜ | - | |
| T3.7 | ⬜ | - | |
| T3.8 | ⬜ | - | |
| T4.1 | ⬜ | - | |
| T4.2 | ⬜ | - | |
| T4.3 | ⬜ | - | |
| T4.4 | ⬜ | - | |
| T4.5 | ⬜ | - | |
| T4.6 | ⬜ | - | |
| T4.7 | ⬜ | - | |
| T4.8 | ⬜ | - | |
| T5.1 | ⬜ | - | |
| T5.2 | ⬜ | - | |
| T5.3 | ⬜ | - | |
| T5.4 | ⬜ | - | |
| T5.5 | ⬜ | - | |
| T5.6 | ⬜ | - | |
| T5.7 | ⬜ | - | |
| T5.8 | ⬜ | - | |
| T5.9 | ⬜ | - | |
| T5.10 | ⬜ | - | |
| T5.11 | ⬜ | - | runs after T8.13 |
| T6.1 | ⬜ | - | |
| T6.2 | ⬜ | - | |
| T6.3 | ⬜ | - | |
| T6.4 | ⬜ | - | |
| T6.5 | ⬜ | - | |
| T6.6 | ⬜ | - | |
| T6.7 | ⬜ | - | |
| T6.8 | ⬜ | - | |
| T6.9 | ⬜ | - | |
| T7.1 | ⬜ | - | |
| T7.2 | ⬜ | - | |
| T7.3 | ⬜ | - | |
| T7.4 | ⬜ | - | |
| T7.5 | ⬜ | - | |
| T7.6 | ⬜ | - | |
| T7.7 | ⬜ | - | |
| T7.8 | ⬜ | - | |
| T7.9 | ⬜ | - | |
| T8.1 | ⬜ | - | |
| T8.2 | ⬜ | - | |
| T8.3 | ⬜ | - | |
| T8.4 | ⬜ | - | |
| T8.5 | ⬜ | - | |
| T8.6 | ⬜ | - | |
| T8.7 | ⬜ | - | |
| T8.8 | ⬜ | - | |
| T8.9 | ⬜ | - | |
| T8.10 | ⬜ | - | |
| T8.11 | ⬜ | - | |
| T8.12 | ⬜ | - | |
| T8.13 | ⬜ | - | |
| T8.14 | ⬜ | - | |
| T8.15 | ⬜ | - | |
| T8.16 | ⬜ | - | |
| T9.1 | ⬜ | - | |
| T9.2 | ⬜ | - | |
| T9.3 | ⬜ | - | |
| T9.4 | ⬜ | - | |
| T9.5 | ⬜ | - | |
| T9.6 | ⬜ | - | |
| T9.7 | ⬜ | - | |
| T9.8 | ⬜ | - | |
| T9.9 | ⬜ | - | |
| T9.10 | ⬜ | - | |
| T10.1 | ⬜ | - | |
| T10.2 | ⬜ | - | |
| T10.3 | ⬜ | - | |
| T10.4 | ⬜ | - | |
| T10.5 | ⬜ | - | |
| T10.6 | ⬜ | - | |
| T11.1 | ⬜ | - | |
| T11.2 | ⬜ | - | ⚠️ real Liara |
| T11.3 | ⬜ | - | ⚠️ real Liara |
| T11.4 | ⬜ | - | |
| T11.5 | ⬜ | - | |
| T11.6 | ⬜ | - | |
| T11.7 | ⬜ | - | |
| T11.8 | ⬜ | - | |
| T11.9 | ⬜ | - | |
| T11.10 | ⬜ | - | |
| T11.11 | ⬜ | - | |

## Decisions
- **D-001 (T0.3):** Dev toolchain beyond the AGENT_RULES §2 list: `typescript`, `@types/node`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`. Treated as implied by "TypeScript strict + eslint" (eslint cannot parse TS without them). No runtime libraries outside the list.
- **D-002 (T0.3):** ESLint pinned to 8.57.1 because the task specifies `.eslintrc.cjs` (legacy config format).
- **D-003 (T0.3):** Build with `tsc` (no tsup, which is not on the allowed list).
- **D-004 (T0.4):** Instead of an eagerly-evaluated `config` constant, `src/config/env.ts` exports `getConfig()` (memoized, frozen). An eager constant would throw at import time in live mode without a token, before the CLI could print the Persian message.
- **D-005 (T0.4):** Persian strings for logic-layer errors (`messageFa`) come from `src/ui/cli/i18n/fa.ts`, so `shared/` and `config/` import that file. It is a pure string table with no UI dependencies.
- **D-006 (T0.1):** Spec-only endpoints are documented in ENDPOINTS.md with `Source = spec-only` but **not used** by code until T0.8 confirms them; the map's §4 strategies (list+filter, CLI env read, local ledger) stay the default. Once confirmed, the relevant modules can prefer them behind the same interfaces. **Exception:** when a task explicitly directs using a spec endpoint (T1.13 `getDbConnection` → dbaas details), it is used with a safe fallback; AGENT_RULES §1.2 lists `specs/*.yaml` as an allowed source.
- **D-007 (T1.1):** HTTP 429 surfaces as `RateLimitError` (with `retryAfterMs`, status in `details`) rather than `LiaraApiError`, so the rate-limit guard (T2.6) can catch it by class. All other non-2xx → `LiaraApiError` with `status`, `code` (BAD_REQUEST/UNAUTHORIZED/FORBIDDEN/NOT_FOUND/CONFLICT/SERVER_ERROR), `operationId`, `messageFa`. Network/timeout → `LiaraApiError` code NETWORK_ERROR/TIMEOUT. Schema mismatch → `ValidationError`.
- **D-009 (T1.8):** With unknown update-envs semantics, `unsetEnv` uses `liara env:unset` instead of "send the list without the keys": the latter silently does nothing if Liara merges, the former is correct either way.
- **D-008 (T1.2):** Until T0.5 records real fixtures, tests use spec-derived synthetic fixtures under `fixtures/liara/spec/` (fake values, unknown enums as explicit placeholders like `SYNTHETIC_STATUS`). `tests/helpers/fixtures.ts#loadFixture(name)` prefers `fixtures/liara/<name>` (recorded) over `spec/<name>`, so recorded fixtures replace them by filename without touching tests.

## Proposed tasks
_(none yet)_

## Files touched per task
- **T0.3:** package.json, pnpm-lock.yaml, pnpm-workspace.yaml, tsconfig.json, tsconfig.build.json, .eslintrc.cjs, .prettierrc, vitest.config.ts, vitest.e2e.config.ts, .gitignore, .env.example, src/**/index.ts, tests/unit/placeholder.test.ts, .gitkeep in specs/ fixtures/liara/ scripts/ demo-apps/ tests/{unit,integration,e2e}; docs/PROGRESS.md, docs/OPEN_QUESTIONS.md, docs/liara/BEHAVIOR.md (bootstrap).
- **T0.4:** src/config/{env,models,index}.ts, src/shared/{errors,result,logger,time,index}.ts, src/ui/cli/i18n/fa.ts, tests/unit/shared/{logger,errors,time}.test.ts, tests/unit/config/env.test.ts, package.json, pnpm-lock.yaml.
- **T2.3:** src/safety/{redact,index}.ts, tests/unit/safety/redact.test.ts.
- **T2.2:** src/safety/{approval,index}.ts, src/ui/cli/i18n/fa.ts (approval), tests/unit/safety/approval.test.ts.
- **T2.1:** src/safety/risk.ts, tests/unit/safety/risk.test.ts.
- **T1.13:** src/liara/{db,index}.ts, src/ui/cli/i18n/fa.ts (db), tests/unit/liara/db.test.ts.
- **T1.8:** src/liara/{env,index}.ts, tests/unit/liara/env.test.ts, docs/OPEN_QUESTIONS.md (OQ-19).
- **T1.14:** src/liara/{cli,cli-parsers,index}.ts, src/ui/cli/i18n/fa.ts (cli), tests/unit/liara/cli.test.ts, package.json (execa), docs/OPEN_QUESTIONS.md (OQ-16..18).
- **T1.11:** src/liara/api/{disks,index}.ts, src/shared/{secret,logger,index}.ts, src/ui/cli/i18n/fa.ts (disks), fixtures/liara/spec/disks.list.json, tests/unit/liara/disks.test.ts, tests/unit/shared/secret.test.ts.
- **T1.6:** src/liara/{ledger,index}.ts, tests/unit/liara/ledger.test.ts.
- **T1.5:** src/liara/{archive,http,index}.ts, src/liara/api/{deploy,index}.ts, tests/unit/liara/{archive,deploy}.test.ts, package.json (tar), docs/OPEN_QUESTIONS.md (OQ-15).
- **T1.4:** src/liara/api/{logs,index}.ts, fixtures/liara/spec/logs.json, tests/unit/liara/logs.test.ts, docs/OPEN_QUESTIONS.md (OQ-14).
- **T1.3:** src/liara/api/{metrics,index}.ts, src/liara/api/schemas/metrics.ts, fixtures/liara/spec/metrics.{summary,cpu}.json, tests/unit/liara/metrics.test.ts, tests/unit/liara/endpoints-guard.test.ts.
- **T1.2:** src/liara/api/{apps,index}.ts, src/liara/api/schemas/apps.ts, src/liara/{wait,index}.ts, src/ui/cli/i18n/fa.ts (apps, wait), fixtures/liara/spec/{README.md,projects.list.json}, tests/helpers/fixtures.ts, tests/unit/liara/{apps,endpoints-guard}.test.ts.
- **T1.1:** src/liara/{http,index}.ts, src/shared/errors.ts (LiaraApiError code/operationId), src/ui/cli/i18n/fa.ts (liaraHttp), tests/unit/liara/http.test.ts, package.json + pnpm-workspace.yaml (msw).
- **T0.7:** .github/workflows/ci.yml.
- **T0.6:** demo-apps/node-express-ok/{package.json,package-lock.json,index.js,.env.example,.liaraignore,README.md}, demo-apps/static-ok/{index.html,README.md}, scripts/check-demo-apps.sh.
- **T0.2 (partial):** scripts/llm-smoke.ts, package.json (openai).
- **T0.1:** scripts/fetch-specs.ts, specs/{paas,billing,me,dbaas,dns}.yaml, specs/pages/*.md, docs/liara/ENDPOINTS.md, docs/liara/SPEC_DIFF.md, docs/OPEN_QUESTIONS.md, package.json (yaml).
