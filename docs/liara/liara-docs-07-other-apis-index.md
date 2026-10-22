# Other Liara API sections (index only)

These sections exist on `https://developers.liara.ir` but their detailed pages were **not** supplied. Page paths come from the official index (`https://developers.liara.ir/llms.txt`); each endpoint page is at `https://developers.liara.ir/<path>.md`, schema at `https://developers.liara.ir/spec/<name>.yaml`.

Same auth everywhere unless stated: `Authorization: Bearer <API_TOKEN>`, base `https://api.liara.ir`.

## Account & billing (`spec/billing.yaml`, `spec/me.yaml`)
- `billing/billing/get-current-user-billing-information` — see `liara-docs-05-billing.md`
- `account/user/get-current-user-and-console-information` (in team mode also includes a `team` object)
- `account/user/get-current-subscription-plan` (empty object when none)
- `account/user/get-two-factor-authentication-status`
- `account/user/get-remaining-free-credit`
- `account/user/get-git-integrations` (connected Git providers and repo integrations)
- `account/user/get-utm-information`

## PaaS pages not supplied (`spec/paas.yaml`)
- `pass/apps/get-applets-of-app`
- `pass/domains/check-a-domain`

## DNS API (`spec/dns.yaml`)
Zones: list all zones, create zone, get zone (with records), delete zone · `check-name-servers/check-nameserver` · Records: get all, create, get, edit (type cannot be edited), delete.

## DBaaS API (`spec/dbaas.yaml`)
Databases: get, delete, get all, create, power on/off, resize, settings, change control-panel status, change public network status · Backups: get all, backup, download · Reports: cpu, memory, network-receive, network-transmit, summary · events of a database.

## Object Storage API (`spec/object-storage.yaml`)
Buckets: list, create, list migration operations, change access policy (public/private), upgrade, get single, destroy, check availability, migrate, list storage-service buckets · Keys: list, create, get, delete, update, revoke secret · Objects: download/upload (presigned URLs), list (max 50), delete, stat · Folders: create, delete · Metrics: summary, historical, statistics.

## File Browser API (`spec/file-browser.yaml`)
For disks attached to apps: list, search, serve file, create link, rename, create file/dir, extract, upload, delete.

## Mail API (`spec/mail.yaml`)
Mail servers (CRUD, DNS check, domain availability, unfreeze, usage), SMTP credentials, mail accounts, inbound rules, messages (list/send/get/html/trash/delete), forwarding, attachments, events, tags, plans.

## IaaS API (`spec/Iaas.yaml`)
VMs: list, create, details, delete, unfreeze, traffic graph/volume, power, disks (details/create/extend/delete), reset network, operations, reset password, resize · **Get all plans** · available operating systems.

## AI API (`spec/ai-*.yaml`) — Liara's own OpenAI-compatible service
Chat completions (streaming SSE, tool calling, multimodal), list models, image generation/edit, embeddings, text-to-speech, speech-to-text, workspaces (CRUD, provider preferences, resize/change plan, unfreeze, free token usage, activity, model limits), API keys (CRUD), model catalog (v1/v2), logs, playground endpoints.
