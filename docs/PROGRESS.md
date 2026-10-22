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
| T1.1 | ✅ | (see git log `T1.1:`) | `LiaraHttp` (native fetch): get/post/delete with query/body/multipart/schema; 20s / 10min (multipart) timeouts; GET-only retry (429/502/503/504/network/timeout, max 3, Retry-After honored, exp backoff + jitter); empty 200/204 → `{accepted:true}`; status → code + Persian message; `getStats()`. 429 → `RateLimitError` (D-007). `LiaraApiError` now takes `code` + `operationId`. teamID transport → OQ-13. msw postinstall denied in pnpm-workspace.yaml (browser worker only). |
| T1.2 | ⬜ | - | |
| T1.3 | ⬜ | - | |
| T1.4 | ⬜ | - | |
| T1.5 | ⬜ | - | |
| T1.6 | ⬜ | - | |
| T1.7 | ⬜ | - | |
| T1.8 | ⬜ | - | |
| T1.9 | ⬜ | - | |
| T1.10 | ⬜ | - | |
| T1.11 | ⬜ | - | |
| T1.12 | ⬜ | - | |
| T1.13 | ⬜ | - | |
| T1.14 | ⬜ | - | |
| T1.15 | ⬜ | - | |
| T1.16 | ⬜ | - | |
| T1.17 | ⬜ | - | |
| T2.1 | ⬜ | - | |
| T2.2 | ⬜ | - | |
| T2.3 | ⬜ | - | |
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
- **D-006 (T0.1):** Spec-only endpoints are documented in ENDPOINTS.md with `Source = spec-only` but **not used** by code until T0.8 confirms them; the map's §4 strategies (list+filter, CLI env read, local ledger) stay the default. Once confirmed, the relevant modules can prefer them behind the same interfaces.
- **D-007 (T1.1):** HTTP 429 surfaces as `RateLimitError` (with `retryAfterMs`, status in `details`) rather than `LiaraApiError`, so the rate-limit guard (T2.6) can catch it by class. All other non-2xx → `LiaraApiError` with `status`, `code` (BAD_REQUEST/UNAUTHORIZED/FORBIDDEN/NOT_FOUND/CONFLICT/SERVER_ERROR), `operationId`, `messageFa`. Network/timeout → `LiaraApiError` code NETWORK_ERROR/TIMEOUT. Schema mismatch → `ValidationError`.

## Proposed tasks
_(none yet)_

## Files touched per task
- **T0.3:** package.json, pnpm-lock.yaml, pnpm-workspace.yaml, tsconfig.json, tsconfig.build.json, .eslintrc.cjs, .prettierrc, vitest.config.ts, vitest.e2e.config.ts, .gitignore, .env.example, src/**/index.ts, tests/unit/placeholder.test.ts, .gitkeep in specs/ fixtures/liara/ scripts/ demo-apps/ tests/{unit,integration,e2e}; docs/PROGRESS.md, docs/OPEN_QUESTIONS.md, docs/liara/BEHAVIOR.md (bootstrap).
- **T0.4:** src/config/{env,models,index}.ts, src/shared/{errors,result,logger,time,index}.ts, src/ui/cli/i18n/fa.ts, tests/unit/shared/{logger,errors,time}.test.ts, tests/unit/config/env.test.ts, package.json, pnpm-lock.yaml.
- **T1.1:** src/liara/{http,index}.ts, src/shared/errors.ts (LiaraApiError code/operationId), src/ui/cli/i18n/fa.ts (liaraHttp), tests/unit/liara/http.test.ts, package.json + pnpm-workspace.yaml (msw).
- **T0.7:** .github/workflows/ci.yml.
- **T0.6:** demo-apps/node-express-ok/{package.json,package-lock.json,index.js,.env.example,.liaraignore,README.md}, demo-apps/static-ok/{index.html,README.md}, scripts/check-demo-apps.sh.
- **T0.2 (partial):** scripts/llm-smoke.ts, package.json (openai).
- **T0.1:** scripts/fetch-specs.ts, specs/{paas,billing,me,dbaas,dns}.yaml, specs/pages/*.md, docs/liara/ENDPOINTS.md, docs/liara/SPEC_DIFF.md, docs/OPEN_QUESTIONS.md, package.json (yaml).
