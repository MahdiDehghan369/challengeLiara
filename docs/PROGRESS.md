# PROGRESS — siavash-agent

> Persistent state for the build. A fresh session resumes from this file alone.
> Statuses: ⬜ not started · 🚧 in progress · ✅ done · ⛔ blocked (reason in Notes)

## Resume here
- **Current task:** —
- **Next (critical path):** see "Order" below; first ⬜ whose dependencies are ✅.
- **Blocker chains (2026-10-22):** T0.2 (needs `BOXAPI_API_KEY`) → T3.1 → T3.2/T3.8 → T4.5 → T4.7/T4.8/T5.3/T7.9/T8.3/T8.8 … · T0.5 (needs `LIARA_API_TOKEN`, user deferred) → T1.10 → T1.16 → T1.17 → T3.3 → T5.1/T6.1/… and T4.6 → T4.7/T7.2.
- **Unblocked queue at that point (MVP order first):** T6.4, T6.5, T7.1, T7.3, T8.1, T8.2, T8.7, T9.1, T9.5, T11.1; then non-MVP: T1.7, T1.9, T1.12, T1.15, T2.5, T2.6, T6.6, T6.7, T6.8, T9.9.

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
| T0.2 | ✅ | 3992970 | Ran `pnpm tsx scripts/llm-smoke.ts` on 2026-10-22: 10 models × 4 checks → `docs/LLM_COMPAT.md` (all 6 columns) + `config/models.json` (zod-valid). Native tools work on gpt-5.x (5-mini, 5.4-mini, 5.6-luna/terra/sol); gpt-6.x reject tools with reasoning_effort; gpt-5.3-codex unsupported on Chat Completions (OQ-26). Roles: chat=gpt-5.4-mini (native-tools), reasoning=gpt-6.1-sol (json), code=gpt-6.1-sol (json), cheap=gpt-5-mini (native-tools). |
| T0.3 | ✅ | 5fbd061 | Skeleton per 01-ANALYSIS §3. tsc build (rootDir src → dist), NodeNext ESM (imports use `.js`). ESLint 8.57 + `.eslintrc.cjs`; vitest forces LIARA_MODE/LLM_MODE=mock; e2e via `vitest.e2e.config.ts`. Also committed the planning docs and the user's README.md deletion. |
| T0.4 | ✅ | b147f50 | zod 4, pino 9, dotenv 17. Config exposed as `getConfig()` (memoized, loads .env) + pure `loadConfig(env)` — see D-004. Logger: pino `redact` paths + deep case-insensitive key scrub + `token=` URL scrub in objects and messages. Seed `src/ui/cli/i18n/fa.ts` created (T9.1 expands). `config/models.json` schema: `{baseUrl, roles:{chat,reasoning,code,cheap:{model,fallbackProtocol,fallbacks[]}}}`. |
| T0.5 | ✅ | eceea95 | App-independent part (user chose no app, 2026-10-22). Scripts: `record-fixtures.ts --app <name|none>` (GET + list commands only; redact → write → secret scan), `redact-fixture.ts`, `check-secrets.ts` (`pnpm tsx scripts/check-secrets.ts fixtures/` green). Recorded to `fixtures/liara/recorded/` (D-011): projects.list, billing, cli.plan-list, cli.app-list, cli.db-list.error (empty account). Answered OQ-4, OQ-5, OQ-27; OQ-7 partial (`ACTIVE`). Liara CLI not on this shell's PATH → runs via `npx -y @liara/cli` (v9.6.0, `ensureCli` fallback). Contract tests: tests/unit/liara/recorded-contract.test.ts. Fixed `dbList` to return [] on "Not found any database.". Acceptance "≥14 fixtures" deferred with the app-specific set → T0.5-b. |
| T0.5-b | ⏳ | - | App-specific fixtures (metrics since variants, logs since s/ms/ISO, events, disks, domains, env:list shape) → record with `pnpm tsx scripts/record-fixtures.ts --app <spike-app>` during T0.8, before the spike app is deleted. Answers OQ-1, OQ-2, OQ-3, OQ-6. |
| T0.6 | ✅ | d98d917 | Done ahead of T1.x per TASKS "day one" order (T0.8 depends on it). Express 5 app with npm lockfile (Liara builds with npm). Verified on Windows: `PORT=3999 node index.js` → `/health` 200, `/api/items` OK. `scripts/check-demo-apps.sh` needs bash (not on this machine; runs in CI/Linux). |
| T0.7 | ✅ | 44a99d8 | GitHub Actions: Node 22, pnpm via corepack (`packageManager` pin), install --frozen-lockfile → typecheck → lint → test with LIARA_MODE/LLM_MODE=mock. No secrets. Not yet observed running on GitHub (nothing pushed). |
| T0.8 | ⬜ | - | ⚠️ needs LIARA_API_TOKEN + human confirmation for each change |
| T1.1 | ✅ | b58085a | `LiaraHttp` (native fetch): get/post/delete with query/body/multipart/schema; 20s / 10min (multipart) timeouts; GET-only retry (429/502/503/504/network/timeout, max 3, Retry-After honored, exp backoff + jitter); empty 200/204 → `{accepted:true}`; status → code + Persian message; `getStats()`. 429 → `RateLimitError` (D-007). `LiaraApiError` now takes `code` + `operationId`. teamID transport → OQ-13. msw postinstall denied in pnpm-workspace.yaml (browser worker only). |
| T1.2 | ✅ | 0f336cb | `AppsApi` (list w/ 5s cache + `fresh`, find/get/resolve with Levenshtein suggestion → `APP_NOT_FOUND`, create (409 → `APP_NAME_TAKEN`), delete/scale/restart/resize → `{accepted:true}`, cache invalidated on mutation). `wait.ts`: `waitForState` (`WAIT_TIMEOUT` with last value), `waitAppGone`, `waitAppScale`, `waitAppRunning` (scale=1 ∧ isDeployed≠false ∧ optional probe; status strings TODO(OQ-7)). Tests use **spec-derived synthetic fixtures** in `fixtures/liara/spec/` (loader prefers recorded ones). New guard test: `tests/unit/liara/endpoints-guard.test.ts` fails if `src/liara/api` uses a path that is not a `map` row of ENDPOINTS.md. |
| T1.3 | ✅ | 918944d | `MetricsApi.getSummary` → `{cpu:[{applet,value,ts}], memory, disks:[{name,sizeRaw,usageRaw,reportedAt}]}` (summary `value` is an array per spec; treated as `[ts, value]`, last element = value). `getSeries(name, kind, windowSec)` → `{kind, unit, series:[{applet,points}], dropped, end}`; `since` encoded inside via `sinceMode` (default 'absolute' = now−window; TODO(OQ-2)); `unit: 'unknown'` (TODO(OQ-3)). 2 `it.todo` for OQ-2/OQ-3. "Parse real fixtures" acceptance is pending T0.5 (synthetic spec fixtures used). Guard test now matches `{}` segment-wise. |
| T1.4 | ✅ | 1a22af9 | `LogsApi.getLogs` (`since` via `sinceFormat` unix-s default / unix-ms / iso, TODO(OQ-1)) → `LogLine {ts(ms), stream, text, source}`; `tailLogs` AsyncIterable (since=last ts, sha1 dedupe bounded 5000, AbortSignal); `followLogs` / `getLogsByRelease` via a `LogsCli` interface (`run`, `streamLines`) that T1.14 must implement; `parseCliLogLine` tolerant (OQ-14). Same `LogLine` type for API and CLI (test). |
| T1.5 | ✅ | f703fdf | `archive.ts`: own minimal gitignore matcher (no extra lib), `.liaraignore` > `.gitignore`, always drops node_modules/.git/.siavash/.env* (keeps .env.example); tar.gz via `tar` → `{path, sizeBytes, fileCount, sha256, files, ignoreSource, warnings}` (>200MB → ARCHIVE_TOO_LARGE). `DeployApi`: `uploadSource` streams a hand-built multipart body (new `LiaraHttp` `rawBody` option, duplex 'half') with % progress; `createRelease`; `waitForRelease` composes pluggable `ReleaseSignal`s (TODO(OQ-15)). |
| T1.6 | ✅ | 6fa74af | `DeploymentLedger` JSONL at `${dataDir}/ledger/<app>.jsonl` + copy in `<project>/.siavash/deployments.jsonl`. Append-only: `update` appends a full snapshot; last line per id wins. Corrupt lines skipped + reported (`onCorruptLine` + pino warn). `record/update/list/latest/previousHealthy/findByCommit`; record also has `rollbackOf?` and result `pending`. `previousHealthy` = last `success` before latest (or before a given id); T7.6 verdicts may refine. |
| T1.7 | ✅ | aaf4061 | `src/liara/api/events.ts`: `EventsApi.getEvents(name, {start, end, search})` on `GET /v1/projects/{name}/events` (unix s, floored; empty search omitted), oldest first. `parseEventRow` is tolerant per TODO(OQ-6) (timestamp of any precision/ISO, JSON message unpacked into meta, unknown → `unknown` + raw); `classifyEvent` → deploy/restart/scale/crash/oom/config/unknown. Synthetic fixture `fixtures/liara/spec/events.json`; `it.todo` for the recorded one. |
| T1.8 | ✅ | c3f3715 | `EnvApi(http, cli, {semantics})`: listEnv via CLI (Secret values); setEnv: replace/unknown → read-all→merge→send-all, merge → only new; unsetEnv: replace → send-without, merge/unknown → `env:unset` (D-009). Result `{before, after (re-read), diff, restartsApp:'unknown'}` (deviation: spec says boolean; 'unknown' until OQ-19). Only keys are logged. Matrix test (client unknown×server replace/merge, etc.) proves no env is lost. |
| T1.9 | ✅ | 56ba0a6 | `src/liara/api/settings.ts`: `SettingsApi.setZeroDowntime / setDefaultSubdomain / setFixedIp (→ ip) / setReadOnly(name, on)`. All resolve `{id}` via `resolveApp` and post `.../{setting}/enable|disable`. 409 → `{accepted, alreadyInState: true}`; other errors propagate. msw test asserts no path uses the name. |
| T1.10 | ✅ | (see git log `T1.10:`) | `src/liara/api/billing.ts`: `BillingApi.getBilling({scope?})` → `{balanceToman (always a finite number; strings/commas coerced, else ValidationError), accountType, minCreditThreshold, alertEnabled (= threshold > 0), manualThreshold, lastNotifiedAt, scope}`; prefers team when present (recorded fixture has user + team). `src/liara/api/account.ts`: `AccountApi.getMe()` → `{tokenValid, appCount}` via the projects list (spec-only "me" endpoint not used: OQ-28). |
| T1.11 | ✅ | 9bdf026 | `DisksApi` per map: `{id}` (via resolveApp) for list/delete disk + all backups; `{name}` for create/resize disk + FTP list/create; `/v1/ftp/{fname}` delete. 409 on delete → `DISK_IN_USE`. Sizes sent as strings. New `src/shared/secret.ts` (`Secret<T>`: toString/toJSON/inspect/toPrimitive → `[SECRET]`, `reveal()`, `maskSecret`). FTP passwords and the backup download link (likely pre-signed URL) are `Secret`. Logger's deep scrub now serializes via `toJSON` (Secret/Date). Tests prove `{id}`/`{name}` per path via msw request log. |
| T1.12 | ✅ | 0a55255 | `src/liara/api/domains.ts`: `DomainsApi.listDomains(app)` (`?project=`), `createDomain(name, app, type=PROJECT)` (201 → id; 409 → `DOMAIN_EXISTS`), `attachDomain(domainID, appId)` + `attachDomainToApp` (resolveApp), `setRedirect(id, 301/302, to)`, `enableSsl(domain)` → code, `disableSsl(id)` (204), `deleteDomain(id)`. `src/liara/dns.ts`: `resolveCname` / `resolveA` (injectable resolver, normalized, no record → []), `dnsMatches(domain, {cname?, a?})`, `zoneCheck(cli, domain)` → `{ok, output}`. |
| T1.13 | ✅ | 6868753 | `DbApi(cli, http)`: create (publicNetwork default false)/list(raw)/start/stop/resize/remove via CLI. `getDbConnection(name)` uses spec-only dbaas `GET /v1/databases` (match `hostname`) → `GET /v1/databases/{id}`; internal `{hostname, internalPort}`, public `{node.host, port}` only if publicNetwork; password + connection string as `Secret`; any failure → `{status:'needs-human', instructionFa}` (TODO(OQ-12)). `buildConnectionString` postgres/mysql/mariadb/mongodb with URL-encoded creds. |
| T1.14 | ✅ | 4720aae | `LiaraCli` over an injectable `Spawner` (default execa 9, `reject:false`, merged lines via `iterable({from:'all'})`). Always appends `--api-token`/`--team-id`; `scrub()` removes the token from logged args, streamed lines, stdout and errors (logger-spy test). Non-zero exit/timeout → `ExternalCommandError` with last 50 lines. `ensureCli` (liara → `npx -y @liara/cli` → not installed + Persian hint). Commands: planList (raw, OQ-5), envList (→ Secret, OQ-17), envUnset, db create/list/start/stop/resize(-d y)/remove (flags per docs: `db stop` has no -y), logs, shell, zoneCheck, deploy (events; placeholder stage regexes OQ-16; 15 min timeout). Implements `LogsCli` for T1.4. OQ-18: token is visible in argv. |
| T1.15 | ✅ | 2348217 | `src/liara/console.ts`: `LiaraConsole.runInContainer(app, cmd, {timeoutMs=15000})` → `{stdout, exitCode?, timedOut, via}`. WS first (`wss://api.liara.ir?token&cmd=/bin/bash&project_id=<id>` + teamID; id via resolveApp; URL never logged); protocol per TODO(OQ-23): raw text frame + nonce exit sentinel; the timeout always terminates the socket. Error before open → `liara shell -a -c` fallback. Output ANSI-stripped, token-scrubbed, redacted. Tested against a local `ws` WebSocketServer (incl. 401 → fallback). Deps: ws (allowed) + @types/ws (D-010). |
| T1.16 | ⬜ | - | |
| T1.17 | ⬜ | - | |
| T2.1 | ✅ | e801ad9 | `Risk` numeric enum, `ActionPlan` (+ `escalations` codes), `escalate(plan, {productionApps, protectedApps, envSemantics})` never lowers risk: stop/scale=0 on production|protected → R3; secret-like env keys (`*_KEY, *_SECRET, *PASSWORD*, *TOKEN*, DATABASE_URL, *_URI`) → ≥R2; replace semantics + removed vars (`params.removedCount` or unset keys) → R3; fixed-ip enable → R2. Tool names fixed in `RISK_TOOLS` (stop_app, scale_app, set_env, unset_env, set_fixed_ip) — the registry must reuse them. |
| T2.2 | ✅ | 4d9f8bd | `Approver.request(plan, ctx?)` → `approved \| approved-session \| denied \| {edited} \| {pending:{token,expiresAt}}` (extended for session + MCP two-step). Approvers: `AutoDenyApprover`, `YesApprover` (R1 only; enforces "--yes never approves R2/R3"), `ScriptedApprover`, `McpApprover` (5-min single-use token bound to sha256 of tool+target+params, key-order independent). `guard(plan, approver, exec, {dryRun, audit, session, confirmToken, reassess, actor, sessionId})`: R0 direct; R1+ approver; session approval only R1 per tool+app; edited params re-assessed (higher risk → ask again, never lowered); dry-run; every path calls `AuditSink.record` (T2.4 implements). `CliApprover` is T9.5. |
| T2.3 | ✅ | fe9c02b | `Secret<T>` already from T1.11 (src/shared/secret.ts). `src/safety/redact.ts`: `Redactor` (rules: PEM keys, Bearer/Basic, JWT, sk-/rk-/pk- keys, GitHub, AWS AKIA, Slack, `scheme://user:pass@` → `user:***@`, secret query params incl. `?token=`, secret-named KEY=/KEY: assignments; plus session-known secret values ≥6 chars via `addKnownSecret`), `redactObject` recursive (sensitive keys, Secret → [SECRET], Date kept, input not mutated). `defaultRedactor` + `redactText/redactObject`. 23 secret samples hidden; 10 normal texts untouched. Must be used before sending logs/code to an LLM. |
| T2.4 | ✅ | b86316a | `AuditLog(dataDir)` implements `AuditSink`: JSONL `${dataDir}/audit.jsonl` with `{id, ts, sessionId, actor, tool, risk, target, decision, paramsRedacted, result, errorCode?, durationMs, undo?}`; params via `redactObject`. New `ActionPlan.undo {tool, params, secretValues?}`: secret previous values go to `${dataDir}/undo/<id>.json` (mode 0600; on Windows modes are best-effort) and the entry keeps `secretRef`. `read/readAudit({since, app, tool})` skips corrupt lines; `readUndoSecrets` for T10.6. Test proves every guard path (ok/denied/dry-run/error) writes exactly one record. |
| T2.5 | ✅ | 528b1bd | `src/safety/policy.ts`: zod `PolicySchema` {protectedApps, maxMonthlyCostToman?, allowSessionApprove=true, headless.allow ⊂ [R0,R1]} (R2/R3 can never be headless), `loadPolicy` (missing → defaults; invalid → Persian ValidationError), `applyPolicy` (protected → ≥R2; monthly cost > cap → deny POLICY_COST_CAP with Persian reason; headless → allow/deny POLICY_HEADLESS). `guard()` takes `{policy, headless}`: applies the policy before asking (approver never sees denied plans), re-checks the cap after edits, `allowSessionApprove:false` makes session approval count once; new decision `policy-headless`. `siavash.policy.example.yaml`. |
| T2.6 | ✅ | 2114173 | `src/safety/budget.ts`: `SessionBudget` (Liara requests in a sliding 60 s window: soft 60 → one warning, hard 120 → `BudgetExceededError`; LLM requests + tokens per session, soft/hard), `LoopBreaker` (N=8 steps without progress, or the same tool+params (order-insensitive hash) more than 3 times → stop with a Persian message). `LiaraHttp` gained `onRequest` (runs before each attempt; throwing aborts before sending). New `BudgetExceededError` (code BUDGET_EXCEEDED). Acceptance: an endless scripted mock-LLM loop stops at call 4. Limits per TODO(OQ-24). |
| T3.1 | ⬜ | - | |
| T3.2 | ⬜ | - | |
| T3.3 | ⬜ | - | |
| T3.4 | ⬜ | - | |
| T3.5 | ⬜ | - | |
| T3.6 | ⬜ | - | |
| T3.7 | ⬜ | - | |
| T3.8 | ⬜ | - | |
| T4.1 | ✅ | a021f24 | `detectPlatform(root)` deterministic order per task → `{platform, liaraPlatformId, version, confidence, evidence[]}`; internal platforms docker/next/react-static/node/django/flask/fastapi/laravel/go/static/unknown. `platform-map.ts`: only docs-backed ids (docker, next) + `node` (tasks doc, unverified); rest undefined, TODO(OQ-20). `project-files.ts` helpers (safe reads, python requirements incl. pyproject/Pipfile, file listing skipping vendor dirs). 12 fixture projects in `tests/fixtures/projects/` (excluded from tsc/eslint). |
| T4.2 | ✅ | bbae60f | `AnalyzerWarning {code, severity: blocker/warning/info, messageFa, fixFa, evidence}` (src/analyzer/types.ts). `detectPort(root, platform)` → `{port, source: env-default/listen/expose/cli-flag/platform-default, readsPortEnv, bindHost, evidence, warnings}`; PORT_HARDCODED, BIND_LOCALHOST (blocker, incl. flask `app.run()`), PORT_DEFAULT_ASSUMED (info; defaults are framework conventions, not Liara facts). `detectScripts` → `{install, build, start, warnings}`: NO_START_SCRIPT, NODEMON_START, RUNTIME_IN_DEV_DEPS, NO_BUILD_SCRIPT, PYTHON_NO_SERVER. |
| T4.3 | ✅ | 6281d6a | `detectEnv(root, {readDotEnv?})` → `{vars: [{name, sources, hasDefault, required, isSecret, suggestedValue?, managedByAgent}], dotenv?}`. Sources: .env.example/.sample/.dist/.template + code scan (process.env.X / ['X'], import.meta.env, os.environ[..] (hard → required), os.environ.get / os.getenv / getenv / env() with default detection, Go os.Getenv). required = no default ∧ (startup use: top-level line or entry file, or empty in example). PORT/NODE_ENV `managedByAgent`. isSecret reuses `isSecretEnvName` (safety/risk). Secret example values never suggested. Real `.env` only with `readDotEnv:true`, values as Secret. Required first in output. |
| T4.4 | ✅ | 183d0ef | `detectDeps(root, knownEnvNames)` → `{needsDatabase, databases:[{type, envName, evidence}], disk:{needed, folders, evidence}, migrations:[{tool, command, evidence}], warnings}`. DB from node/python packages, prisma provider + `env("X")`, django ENGINE, laravel DB_CONNECTION; env name prefers what the code already uses. Redis alone ≠ database. Disk from upload packages / uploads,media,storage folders / MEDIA_ROOT / sqlite → EPHEMERAL_FS, SQLITE_EPHEMERAL warnings. Migrations: prisma, django, laravel, sequelize, typeorm, knex (MIGRATION_NEEDED info). Absolute mount path TODO(OQ-21). |
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
| T6.4 | ✅ | 3716190 | Ops layer as plain functions over `guard()` (tool wrappers come with T3.3): `src/ops/context.ts` (`OpsContext`, `guardOptions` with `reassess=escalate`, HMAC `fingerprint`, `newPlanId`). `src/ops/env.ts`: `listEnvMasked` (R0), `planSetEnv`/`setEnv` (R1→escalated; one approval per batch; masked diff + restart note in `impactFa`; params carry value fingerprints, never values; undo `{restore, remove}` + previous values via `secretValues` → 0600 file; identical values → `no-change` without asking), `unsetEnv` (R3). Tests use real EnvApi + msw fake Liara (replace semantics) + AuditLog; full mock-adapter integration is `it.todo` until T1.16. |
| T6.5 | ✅ | 634fbb6 | `src/ops/releases.ts`: `listDeployments` (R0, newest first, `whenFa` via new `relTimeFa` in shared/time.ts; deploy *events* not merged yet — T1.7 pending). `rollbackApp` (R2) → target = id or `previousHealthy`; methods in order: `source` (new release w/ old sourceID; `sourceReuse` unknown → try then fall back, OQ-22), `git-api` (temp `git worktree add --detach` → archive → upload → release; worktree always removed), `git-cli`. Card shows current→target with dates + commits + method. Ledger: new record `rollbackOf`, replaced one → `rolled-back`; optional `releaseSignals` wait and `verify()` (T8.10) → `healthAfter`. Added `simple-git`. Test repo pins `core.autocrlf=false` (MinGit CRLF default). |
| T6.6 | ✅ | 20da337 | `src/ops/backups.ts` (plain functions over `guard`): `listDisksWithUsage` (R0; usage % from metrics summary per TODO(OQ-25), Persian warning > 80%), `listBackups` (R0), `createBackup` (R1), `backupDownloadLink` (R1; link stays `Secret` → never in JSON for the LLM), `resizeDisk` / `createFtp` (R2 + backup suggestion in `impactFa` via `withBackupSuggestion`), `createDisk` (R2; new disk → no suggestion). FTP password stays `Secret`. Integration test over msw with real DisksApi/MetricsApi. |
| T6.7 | ✅ | e39b0ce | `src/ops/settings.ts`: `setZeroDowntime` (R1), `setDefaultSubdomain` (R1; disable with no custom domain → R2 + "app goes offline" warning via `listDomains`), `setFixedIp` (R2; `costToman.monthly` when given; `--yes` cannot pass it), `setReadOnly` (R1; warns about mounted disks and caller-supplied `writesTo`). Every plan carries a plain-language Persian effect (on/off) and rollback. Integration test over msw. |
| T6.8 | ✅ | 9b8b113 | `src/ops/delete.ts`: `deleteApp` / `deleteDisk` / `deleteDomain` / `deleteDatabase` / `deleteFtp`, all R3 via `guard`. The card (`impactFa`) lists every dependent resource (`appDependents`: disks + mounts + FTP + domains; disk → mount + FTP), suggests a backup, and says databases are not deleted with an app. Confirmation name is the app, or the resource when there is no app. `deleteApp` confirms with `waitGone` (`waitAppGone`). Tested with the real `CliApprover`: a wrong name or a cancel deletes nothing. |
| T6.9 | ⬜ | - | |
| T7.1 | ✅ | d0ec693 | `probe(url, {paths, count, timeoutMs, fetchImpl})` sequential samples (ttfb at headers, total after body, `redirect: manual`) → `{availability%, p50, p95, errorRate, statusHistogram, errorHistogram{timeout,dns,tls,connection,other}, tlsValid, samples}`; 4xx counts as available, 5xx/errors don't. `classifyProbeError` reads undici `cause.code`. New `src/shared/stats.ts` (mean, nearest-rank percentile, round). TLS covered with a fetch stub (no committed test private key). |
| T7.2 | ⬜ | - | |
| T7.3 | ✅ | c43fbfb | `src/sre/logs.ts`: `collectLogs(source, app, {windowSec, max, redactor})` → `LogRecord {ts, stream, level, text, lineCount}` (sorted, merged, redacted; `max` keeps newest). `detectLevel` (JSON level/severity incl. pino numbers, else text markers: ERROR/FATAL/XxxError:/Traceback/UnhandledPromiseRejection/npm ERR!/heap OOM/Killed; WARN). `mergeMultiline`: Node `    at` frames, Python Traceback → final `XxxError` line, caret lines; never across streams. `LogSource` interface = `LogsApi.getLogs`. |
| T7.4 | ⬜ | - | |
| T7.5 | ⬜ | - | |
| T7.6 | ⬜ | - | |
| T7.7 | ⬜ | - | |
| T7.8 | ⬜ | - | |
| T7.9 | ⬜ | - | |
| T8.1 | ✅ | 15b2a98 | `src/sre/log-cluster.ts`: `errorSignature` (normalized header — ts/uuid/hex/ip/email/long-quoted/path/numbers — + top user frame `fn:basename`; Python uses the final exception line), `parseFrames` (Node + Python, innermost first, `isUserCode` excludes node_modules/site-packages/node:/internal), `clusterLogs(records, {levels=['error']})` → `{signature, count, firstSeen, lastSeen, sample, level, stream, topFrames(≤5), isUserCode}` sorted by count then recency. 1000 lines/3 recurring errors → 3 clusters. |
| T8.2 | ✅ | d2eecc2 | `src/sre/knowledge/patterns.yaml` (53 patterns: Node/Next/Python/Django/Laravel/Docker + fs/net; each has `platforms` and a `sample`; ordered specific→generic) + `index.ts` (zod schema: allowed actionType/category, regex compiles, flags ⊂ imsu, unique ids; `parseKnowledge`, cached `loadKnowledge`, `matchKnowledge(text, {first?})` filling `{n}` from capture groups). `build` copies the yaml into dist. Test loops over every pattern sample. |
| T8.3 | ⬜ | - | |
| T8.4 | ⬜ | - | |
| T8.5 | ⬜ | - | |
| T8.6 | ⬜ | - | |
| T8.7 | ✅ | f600e53 | `src/coder/context.ts`: `mapContainerPath` (longest exact path suffix; bare basename only if unique), `collectCodeContext(root, {frames?, message?, route?}, {maxChars=20000, window=60, maxFrameFiles=3})` → user-frame snippets ±60 lines, else search by route (also tail segments, for mounted routers) / message literals; nearest manifest; direct local imports of the primary file (JS + Python); all redacted, capped, `truncated`/`unresolved` reported. `formatContext` renders numbered lines with a `>` focus marker. Fixture: tests/fixtures/projects/coder-express. |
| T8.8 | ⬜ | - | |
| T8.9 | ⬜ | - | |
| T8.10 | ⬜ | - | |
| T8.11 | ⬜ | - | |
| T8.12 | ⬜ | - | |
| T8.13 | ⬜ | - | |
| T8.14 | ⬜ | - | |
| T8.15 | ⬜ | - | |
| T8.16 | ⬜ | - | |
| T9.1 | ✅ | c0abac2 | `src/ui/cli/format.ts`: `formatNumber` (Persian digits, ٬ thousands, ٫ decimal; `digits: en` option), `toman`, `relTime` (→ relTimeFa), `bytes` (base 1024), `percentBar`, `sparkline`, `withLtr` (Persian line first, LTR fragments on their own indented lines). New `fa.format` / `fa.knowledge.unknownValue` keys. `scripts/check-fa-strings.ts` (`pnpm check:fa`) flags Persian letters in src/**/*.ts outside i18n/prompts/knowledge, ignoring comments and digits; a unit test runs it on src/. |
| T9.2 | ⬜ | - | |
| T9.3 | ⬜ | - | |
| T9.4 | ⬜ | - | |
| T9.5 | ✅ | b3e49f2 | `src/ui/cli/approver.ts`: `renderPlanCard` (what/why/target/cost in toman/coloured risk/escalations/impact/rollback/exact redacted command on its own line), `Prompter` interface + `ClackPrompter` (@clack/prompts), `CliApprover({yes, interactive, prompter, color})`: R1 run/no/session, R2 run/no/edit params (JSON, gate re-assesses), R3 type exact app name. `--yes` approves R1 only; R2/R3 still prompt and are denied without a TTY (tested, also through `guard`). Added deps @clack/prompts, picocolors (allowed list). |
| T9.6 | ⬜ | - | |
| T9.7 | ⬜ | - | |
| T9.8 | ⬜ | - | |
| T9.9 | ✅ | 237fc0b | `src/ui/cli/errors.ts`: `explainError(err)` → `{code, whatFa, doFa, command?, technical, stack?}`. Mapped: missing token/key (config), 401, network/timeout, 429 (Persian wait time from Retry-After), CLI not installed (install command), low balance (402 / text), 409 name taken, deploy/wait timeout (`siavash logs <app>`), APP_NOT_FOUND (keeps the closest-name suggestion), denied, budget, generic, unknown. `formatError(err, {verbose})`: what + do + command on its own line; technical details + stack only with `--verbose`; always redacted. |
| T9.10 | ⬜ | - | |
| T10.1 | ⬜ | - | |
| T10.2 | ⬜ | - | |
| T10.3 | ⬜ | - | |
| T10.4 | ⬜ | - | |
| T10.5 | ⬜ | - | |
| T10.6 | ⬜ | - | |
| T11.1 | ✅ | d6f9bcd | Buggy demo apps (dependency-free except node-db → `pg`), each with a README (bug + expected agent result): node-missing-env (`new URL(undefined)` at startup), node-http500 (`order.items.length` on order 2 + failing `node --test` unit test, also S10), node-memleak (global array ~256 KB/req + `load.sh`), node-slow (sync busy loop), node-db (localhost Postgres fallback → ECONNREFUSED), node-build-fail (TS, no build script), node-bad-release (`make-repo.sh` builds a temp repo with `main` + broken `feature/checkout`). `scripts/check-demo-apps.sh` reproduces every bug; added as a CI step. Each bug was reproduced locally on Windows via node directly. The bash script itself was not run here (WSL has no node) and runs in CI. On this machine a local Postgres exists, so node-db fails with "database does not exist"; the script accepts either. |
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
- **D-010 (T1.15):** @types/ws added as a devDependency (types only, same reasoning as D-001 for @types/node); runtime lib ws is on the allowed list.
- **D-011 (T0.5):** Recorded fixtures go to `fixtures/liara/recorded/` (loaded with `loadRecorded`) instead of overriding `fixtures/liara/<name>` as D-008 planned: unit tests assert synthetic values (e.g. `shop-api`), so real data is used by contract tests that parse it with our schemas, not by replacing test data.
- **D-008 (T1.2):** Until T0.5 records real fixtures, tests use spec-derived synthetic fixtures under `fixtures/liara/spec/` (fake values, unknown enums as explicit placeholders like `SYNTHETIC_STATUS`). `tests/helpers/fixtures.ts#loadFixture(name)` prefers `fixtures/liara/<name>` (recorded) over `spec/<name>`, so recorded fixtures replace them by filename without touching tests.

## Proposed tasks
_(none yet)_

## Files touched per task
- **T0.3:** package.json, pnpm-lock.yaml, pnpm-workspace.yaml, tsconfig.json, tsconfig.build.json, .eslintrc.cjs, .prettierrc, vitest.config.ts, vitest.e2e.config.ts, .gitignore, .env.example, src/**/index.ts, tests/unit/placeholder.test.ts, .gitkeep in specs/ fixtures/liara/ scripts/ demo-apps/ tests/{unit,integration,e2e}; docs/PROGRESS.md, docs/OPEN_QUESTIONS.md, docs/liara/BEHAVIOR.md (bootstrap).
- **T0.4:** src/config/{env,models,index}.ts, src/shared/{errors,result,logger,time,index}.ts, src/ui/cli/i18n/fa.ts, tests/unit/shared/{logger,errors,time}.test.ts, tests/unit/config/env.test.ts, package.json, pnpm-lock.yaml.
- **T1.10:** src/liara/api/{billing,account,index}.ts, tests/unit/liara/billing.test.ts, docs/OPEN_QUESTIONS.md (OQ-28).
- **T0.5:** scripts/{record-fixtures,redact-fixture,check-secrets}.ts, fixtures/liara/recorded/*, src/liara/cli.ts (dbList empty), tests/helpers/fixtures.ts (loadRecorded), tests/unit/liara/recorded-contract.test.ts, tests/unit/scripts/fixtures-redaction.test.ts, docs/OPEN_QUESTIONS.md (OQ-1..7, OQ-27).
- **T0.2:** docs/LLM_COMPAT.md, config/models.json, docs/OPEN_QUESTIONS.md (OQ-26).
- **T9.9:** src/ui/cli/{errors.ts,i18n/fa.ts}, tests/unit/ui/errors.test.ts.
- **T6.8:** src/ops/{delete,index}.ts, src/ui/cli/i18n/fa.ts (opsDelete), tests/unit/ops/delete.test.ts.
- **T6.7:** src/ops/{settings,index}.ts, src/ui/cli/i18n/fa.ts (opsSettings), tests/unit/ops/settings-ops.test.ts.
- **T6.6:** src/ops/{backups,index}.ts, src/ui/cli/i18n/fa.ts (opsDisks), tests/unit/ops/backups.test.ts, docs/OPEN_QUESTIONS.md (OQ-25).
- **T2.6:** src/safety/{budget,index}.ts, src/liara/http.ts (onRequest), src/shared/errors.ts (BudgetExceededError), src/ui/cli/i18n/fa.ts (budget), tests/unit/safety/budget.test.ts, docs/OPEN_QUESTIONS.md (OQ-24).
- **T2.5:** src/safety/{policy,approval,index}.ts, src/ui/cli/i18n/fa.ts (approval policy strings), siavash.policy.example.yaml, tests/unit/safety/policy.test.ts.
- **T1.15:** src/liara/{console,index}.ts, tests/unit/liara/console.test.ts, package.json, pnpm-lock.yaml (ws, @types/ws), docs/OPEN_QUESTIONS.md (OQ-23).
- **T1.12:** src/liara/api/{domains,index}.ts, src/liara/{dns,index}.ts, src/ui/cli/i18n/fa.ts (domains), tests/unit/liara/domains.test.ts.
- **T1.9:** src/liara/api/{settings,index}.ts, tests/unit/liara/settings.test.ts.
- **T1.7:** src/liara/api/{events,index}.ts, fixtures/liara/spec/events.json, tests/unit/liara/events.test.ts, docs/OPEN_QUESTIONS.md (OQ-6 interim note).
- **T11.1:** demo-apps/node-{missing-env,http500,memleak,slow,db,build-fail,bad-release}/**, scripts/check-demo-apps.sh, .github/workflows/ci.yml.
- **T9.5:** src/ui/cli/{approver.ts,i18n/fa.ts}, tests/unit/ui/approver.test.ts, package.json, pnpm-lock.yaml (@clack/prompts, picocolors).
- **T9.1:** src/ui/cli/{format.ts,i18n/fa.ts}, src/sre/knowledge/index.ts, scripts/check-fa-strings.ts, package.json (check:fa), tests/unit/ui/format.test.ts.
- **T8.7:** src/coder/{context,index}.ts, tests/unit/coder/context.test.ts, tests/fixtures/projects/coder-express/**.
- **T8.2:** src/sre/knowledge/{patterns.yaml,index.ts}, src/sre/index.ts, src/ui/cli/i18n/fa.ts (knowledge), package.json (build copies yaml), tests/unit/sre/knowledge.test.ts.
- **T8.1:** src/sre/{log-cluster,index}.ts, tests/unit/sre/log-cluster.test.ts.
- **T7.3:** src/sre/{logs,index}.ts, tests/unit/sre/logs.test.ts.
- **T7.1:** src/sre/{health,index}.ts, src/shared/{stats,index}.ts, tests/unit/sre/health.test.ts.
- **T6.5:** src/ops/{releases,index}.ts, src/shared/time.ts (relTimeFa), src/ui/cli/i18n/fa.ts (rollback, time), tests/unit/ops/releases.test.ts, package.json (simple-git), docs/OPEN_QUESTIONS.md (OQ-22).
- **T6.4:** src/ops/{context,env,index}.ts, src/ui/cli/i18n/fa.ts (opsEnv), tests/unit/ops/env-ops.test.ts.
- **T4.4:** src/analyzer/detect-deps.ts, src/ui/cli/i18n/fa.ts (deps), tests/unit/analyzer/detect-deps.test.ts, docs/OPEN_QUESTIONS.md (OQ-21).
- **T4.3:** src/analyzer/detect-env.ts, tests/unit/analyzer/detect-env.test.ts.
- **T4.2:** src/analyzer/{types,detect-port,detect-scripts}.ts, src/ui/cli/i18n/fa.ts (analyzer), tests/unit/analyzer/detect-port-scripts.test.ts.
- **T4.1:** src/analyzer/{detect-platform,platform-map,project-files}.ts, tests/fixtures/projects/** (12 projects), tests/helpers/projects.ts, tests/unit/analyzer/detect-platform.test.ts, tsconfig.json + .eslintrc.cjs (exclude tests/fixtures), docs/OPEN_QUESTIONS.md (OQ-20).
- **T2.4:** src/safety/{audit,approval,risk,index}.ts, tests/unit/safety/audit.test.ts.
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
