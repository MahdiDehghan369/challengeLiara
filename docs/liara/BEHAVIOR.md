# Liara API — discovered behavior

> Facts discovered from real calls (fixtures in T0.5, spike in T0.8). Each entry: answer or "unknown + fallback", plus the evidence.

## 1. App creation → appears in list; `status` / `isDeployed` values

## 2. `update-envs`: replace or merge? Does it restart the app?

## 3. API deploy (sources → releases): build completion / success signal, timings

## 4. New release with an old `sourceID` (rollback feasibility)

## 5. `liara deploy` CLI output and `--detach`

## 6. `since` format for logs and metrics; CPU / RAM units

## 7. Event types and `values` structure

## 8. Time to steady state after restart / scale 0 / scale 1

## 9. Default URL `https://<name>.liara.run` and `default-subdomain`

## 10. `teamID` in REST: query param or header?

## 11. Rate limits (30 quick `GET /v1/projects`)

## 12. App deletion: time until gone from list
