# Liara PaaS API — metrics ("Reports")

Base URL `https://api.liara.ir` · Auth `Authorization: Bearer <API_TOKEN>` · tag: Reports. Path param `{name}` = app name.

## GET `/v1/projects/{name}/metrics/summary` — summary (`getAppSummaryReports`)
No query params. Response 200:
```
{ cpuUsage:    [ { value: [number|string, ...], applet: string } ],
  memoryUsage: [ { value: [number|string, ...], applet: string } ],
  disksUsage:  [ { size: string, usage: string, reportedAt: string, name: string } ] }
```
Errors: 400, 401, 404.

## Time-series endpoints
| Metric | Path | operationId |
|---|---|---|
| CPU | `GET /v1/projects/{name}/metrics/cpu` | `getAppCpuReports` |
| Memory | `GET /v1/projects/{name}/metrics/memory` | `getAppMemoryReports` |
| Network receive | `GET /v1/projects/{name}/metrics/network-receive` | `getAppNetworkReceiveReports` |
| Network transmit | `GET /v1/projects/{name}/metrics/network-transmit` | `getNetworkTransmitReports` |

Query: `since` (**number, required**) — "the since of your reports"; unit (unix seconds vs relative) is **not specified** → verify with a real call.

Response 200 (schema `Reports`):
```
{ end: number,
  result: [ { values: [ [number|string, number|string], ... ],   // pairs like [timestamp, value]
              applet: string } ] }
```
Errors: 400, 401, 404.

Notes: values may be strings → parse to numbers. Units (CPU cores vs %, memory bytes vs MB) are not documented.
