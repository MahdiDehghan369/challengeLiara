# Liara & BoxAPI reference docs — index

Source: documents supplied by the team (official Liara developer docs, Liara CLI docs, BoxAPI info). Nothing was invented; anything the source did not show is marked **NOT PROVIDED**.

**Start here:** `04-LIARA_API_MAP.md` is the source of truth for which endpoints exist and how we work around missing ones.

| File | Content |
|---|---|
| `04-LIARA_API_MAP.md` | Endpoint map (Persian) + gaps and our strategies — **source of truth** |
| `liara-docs-01-paas-apps-deploy.md` | PaaS: apps (list/create/delete/scale/restart/resize), logs, events, deploy (sources + releases), settings, update-envs, WebSocket console |
| `liara-docs-02-paas-metrics.md` | PaaS: CPU / memory / network / summary metrics |
| `liara-docs-03-paas-disks.md` | PaaS: disks, backups, FTP |
| `liara-docs-04-paas-domains.md` | PaaS: domains (incl. list `GET /v1/domains?project=`), SSL, redirect |
| `liara-docs-05-billing.md` | Billing endpoint `GET /v1/billing` |
| `liara-docs-06-cli.md` | Liara CLI (`@liara/cli`) structured command reference + quirks |
| `liara-docs-07-other-apis-index.md` | Index of other Liara APIs (DBaaS, Object Storage, DNS, Mail, File Browser, IaaS, AI, account) |
| `liara-docs-08-boxapi.md` | BoxAPI (LLM provider for the hackathon) |
| `liara-paas-openapi.md` | **Verbatim** OpenAPI excerpts (paths + schemas) for 35 PaaS endpoints |
| `liara-cli-fa.md` | **Verbatim** official Persian CLI + billing documentation |

Note: `GET /v1/projects/{name}/metrics/summary` and `GET /v1/domains` are documented in files 02 and 04 (team-supplied summaries) but their raw OpenAPI pages were not in the pasted material.

Online index: `https://developers.liara.ir/llms.txt` · Specs: `https://developers.liara.ir/spec/{paas,billing,me,dns,dbaas,object-storage,file-browser,Iaas,mail,ai-*}.yaml` · Pages: `https://developers.liara.ir/<path>.md`

## Exists online but not supplied (T0.1 fetches these)
- PaaS: `pass/apps/get-applets-of-app.md`, `pass/domains/check-a-domain.md`
- Account (`spec/me.yaml`): user & console info, subscription plan, 2FA status, remaining free credit, Git integrations, UTM info
- Billing full schema (`spec/billing.yaml`)
- DBaaS (`spec/dbaas.yaml`): needed for DB connection details
- DNS (`spec/dns.yaml`)
