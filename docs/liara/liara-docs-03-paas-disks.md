# Liara PaaS API — disks, backups, FTP

Base URL `https://api.liara.ir` · Auth `Authorization: Bearer <API_TOKEN>` · tag: Disks. Mind `{id}` (app `_id`) vs `{name}` (app name).

## Disks

### GET `/v1/projects/{id}/disks` — list disks (`getDisks`)
Path `id` = app id. Response 200:
```
{ disks:  [ { _id, name, size (integer), updatedAt, createdAt } ],
  mounts: [ { name, mountedTo } ] }
```
Errors: 400, 401, 404.

### POST `/v1/projects/{name}/disks` — create disk (`createDisk`)
Body (required): `{ name: string, size: string }`. Response **201**. Errors: 400, 401, 404.

### POST `/v1/projects/{name}/disks/{dname}/resize` — resize disk (`resizeDisk`)
Body (required): `{ size: string }`. Response 200. Errors: 400, 401, 404.

### DELETE `/v1/projects/{id}/disks/{name}` — delete disk (`deleteDisk`)
`id` = app id, `name` = disk name. Response 200. Errors: 400, 401, 404, 409 (conflict).

## Backups

### GET `/v1/projects/{id}/disks/{name}/backups` — list backups (`getBackups`)
Response 200: `{ backups: [ { name, lastModified, etag, size (number) } ] }`.

### POST `/v1/projects/{id}/disks/{name}/backups` — create backup (`createBackup`)
No body. Response 200.

### POST `/v1/projects/{id}/disks/{dname}/backups/{bname}/download` — download link (`downloadBackup`)
Response 200: `{ link }`.

## FTP access to a disk

### GET `/v1/projects/{name}/disks/{dname}/ftp` — list FTP accesses (`getFtps`)
Response 200: `{ accesses: [ { _id, disk, username, password, readOnly (bool), createdAt, __v } ], host }`. (Contains passwords → never log/echo.)

### POST `/v1/projects/{name}/disks/{dname}/ftp` — create FTP access (`createFtp`)
Body (required): `{ username: string, readOnly: boolean }`. Response 200: `{ username, password, host }`.

### DELETE `/v1/ftp/{fname}` — delete FTP access (`deleteFtp`)
Path `fname` = ftp name. Response 200. Errors: 400, 401, 404, 409.
