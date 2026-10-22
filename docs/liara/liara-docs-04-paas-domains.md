# Liara PaaS API — domains & SSL

Base URL `https://api.liara.ir` · Auth `Authorization: Bearer <API_TOKEN>` · tag: Domains.

## GET `/v1/domains` — list domains of an app (`getAppDomains`)
Query: `project` (string, **required**, app name). Response 200:
```
{ domains: [ { _id, name, type, project: { _id, project_id },
               status, certificatesStatus, redirectTo, redirectStatus (number),
               created_at, CNameRecord } ] }
```
`CNameRecord` is the DNS value the user must set at the registrar. Errors: 400, 401, 404.

## POST `/v1/domains` — create domain (`createAppDomain`)
Body (required): `{ name: string, project: string, type: string (default "PROJECT") }`. Response **201**: `{ domain: { _id } }`. Errors: 400, 401, 404, 409.

## POST `/v1/domains/set-project` — attach domain to project (`setAppDomain`)
Body (required): `{ domainID: string, projectID: string }`. Response 200. Errors: 400, 401, 404 (app or domain missing).

## POST `/v1/domains/{id}/set-redirect` — redirect (`redirectDomain`)
Path `id` = domain id. Body (required): `{ redirectStatus: number (302 or 301), redirectTo: string }`. Response 200. Errors: 400, 401, 404.

## POST `/v1/domains/provision-ssl-certs` — enable SSL (`enableSsl`)
Body (required): `{ domain: string }`. Response 200: `{ code: string }`. Errors: 400, 401, 404.

## POST `/v1/domains/{id}/ssl/disable` — disable SSL (`disableSsl`)
Path `id` = domain id. Response **204**. Errors: 400, 401, 404.

## DELETE `/v1/domains/{id}` — delete domain (`deleteDomain`)
Response 200. Errors: 400, 401, 404.

## "Check a domain" — **NOT PROVIDED**
Listed in the index (`pass/domains/check-a-domain.md`).

## Registrar-side steps (not covered by any API)
Domain purchase and changing DNS/nameservers at the registrar (e.g. IRNIC-related panels) are done by the user outside Liara. Liara also offers a DNS service (zones/records, "check nameserver") — see `liara-docs-06-cli.md` (`liara zone …`) and `spec/dns.yaml`.
