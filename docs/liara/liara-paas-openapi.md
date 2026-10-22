# Liara PaaS API — OpenAPI excerpts (verbatim)

> استخراج‌شده از مستندات رسمی `https://developers.liara.ir` (spec: `/spec/paas.yaml`) که تیم فراهم کرده.
> بخش‌های تکراری (info، tags، securitySchemes) حذف شده‌اند. فقط `paths` و `components.schemas` هر endpoint آمده است.

**مشترک برای همه:** Base URL `https://api.liara.ir` · Auth: `Authorization: Bearer <API_TOKEN>` (securitySchemes: `jwt` apiKey header `Authorization` و `bearerAuth` http bearer JWT).

**WebSocket console:** `wss://api.liara.ir?token=<api-token>&cmd=/bin/bash&project_id=<project-id>` — پارامترها: `token`، `cmd` (پیش‌فرض `/bin/bash`)، `project_id` (شناسهٔ پروژه)، `teamID` (برای سرویس‌های تیمی).

## فهرست

| Method | Path |
|---|---|
| GET | `/v1/projects` |
| POST | `/v1/projects` |
| DELETE | `/v1/projects/{name}` |
| POST | `/v1/projects/{name}/actions/scale` |
| POST | `/v1/projects/{name}/actions/restart` |
| POST | `/v1/projects/{name}/resize` |
| GET | `/v1/projects/{name}/logs` |
| GET | `/v1/projects/{name}/events` |
| POST | `/v2/projects/{name}/sources` |
| POST | `/v2/projects/{name}/releases` |
| POST | `/v1/projects/{id}/zero-downtime/{status}` |
| POST | `/v1/projects/{id}/default-subdomain/{status}` |
| POST | `/v1/projects/{id}/fixed-ip/{status}` |
| POST | `/v1/projects/{id}/read-only/{status}` |
| POST | `/v1/projects/update-envs` |
| GET | `/v1/projects/{name}/disks/{dname}/ftp` |
| POST | `/v1/projects/{name}/disks/{dname}/ftp` |
| GET | `/v1/projects/{id}/disks` |
| GET | `/v1/projects/{id}/disks/{name}/backups` |
| POST | `/v1/projects/{id}/disks/{name}/backups` |
| POST | `/v1/projects/{id}/disks/{dname}/backups/{bname}/download` |
| POST | `/v1/projects/{name}/disks/{dname}/resize` |
| POST | `/v1/projects/{name}/disks` |
| DELETE | `/v1/projects/{id}/disks/{name}` |
| DELETE | `/v1/ftp/{fname}` |
| GET | `/v1/projects/{name}/metrics/cpu` |
| GET | `/v1/projects/{name}/metrics/memory` |
| GET | `/v1/projects/{name}/metrics/network-receive` |
| GET | `/v1/projects/{name}/metrics/network-transmit` |
| POST | `/v1/domains` |
| POST | `/v1/domains/set-project` |
| POST | `/v1/domains/{id}/set-redirect` |
| POST | `/v1/domains/{id}/ssl/disable` |
| POST | `/v1/domains/provision-ssl-certs` |
| DELETE | `/v1/domains/{id}` |

## GET `/v1/projects`

```yaml
paths:
  /v1/projects:
    get:
      tags:
        - Apps
      summary: Get details of all projects
      description: get all details of all projects that user owns
      operationId: getApps
      responses:
        '200':
          description: Successful operation
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Projects'
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
components:
  schemas:
    Projects:
      type: object
      properties:
        projects:
          type: array
          items:
            type: object
            properties:
              _id:
                type: string
                description: The id of project
              project_id:
                type: string
                description: The name of project
              type:
                type: string
                description: The platform of project
              status:
                type: string
                description: The status of project
              scale:
                type: number
                description: The being on of project
              planID:
                type: string
                description: The plan of project
              created_at:
                type: string
                description: The time to create the project
              isDeployed:
                type: boolean
                description: The project deployment status
```

## POST `/v1/projects`

```yaml
paths:
  /v1/projects:
    post:
      tags:
        - Apps
      summary: Create a app
      description: create app that user owns
      operationId: createApp
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Create-app'
        required: true
      responses:
        '200':
          description: Successful operation
          content: {}
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '409':
          description: Conflict
          content: {}
components:
  schemas:
    Create-app:
      type: object
      properties:
        name:
          type: string
          description: The name of app that you want to create
        planID:
          type: string
          description: The plan of app that you want to create
        platform:
          type: string
          description: The platform of app that you want to create
        readOnlyRootFilesystem:
          type: boolean
          description: For filesystem
        network:
          type: string
          description: For project
```

## DELETE `/v1/projects/{name}`

```yaml
paths:
  /v1/projects/{name}:
    delete:
      tags:
        - Apps
      summary: Delete a app
      description: delete app that user owns
      operationId: deleteAppByName
      parameters:
        - name: name
          in: path
          description: The name of the app to delete
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Your request has been submitted.
          content: {}
        '204':
          description: App deleted.
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
components:
```

## POST `/v1/projects/{name}/actions/scale`

```yaml
paths:
  /v1/projects/{name}/actions/scale:
    post:
      tags:
        - Apps
      summary: Turn on or off a app
      description: turn on or off a app that user owns
      operationId: turnApp
      parameters:
        - name: name
          in: path
          description: The name of the app to turn on or off
          required: true
          schema:
            type: string
      requestBody:
        description: Return 1 to turn on or 0 to turn off
        content:
          application/json:
            schema:
              required:
                - scale
              type: object
              properties:
                scale:
                  type: number
        required: true
      responses:
        '200':
          description: Your request has been submitted.
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
components:
```

## POST `/v1/projects/{name}/actions/restart`

```yaml
paths:
  /v1/projects/{name}/actions/restart:
    post:
      tags:
        - Apps
      summary: To restart a app
      description: to restart app that user owns
      operationId: restartApp
      parameters:
        - name: name
          in: path
          description: The name of the app to restart
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Your request has been submitted.
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
components:
```

## POST `/v1/projects/{name}/resize`

```yaml
paths:
  /v1/projects/{name}/resize:
    post:
      tags:
        - Apps
      summary: Change plan
      description: create app that user owns
      operationId: changePlan
      parameters:
        - name: name
          in: path
          description: The name of your app
          required: true
          schema:
            type: string
      requestBody:
        description: The plan of your app
        content:
          application/json:
            schema:
              required:
                - planID
              type: object
              properties:
                planID:
                  type: string
        required: true
      responses:
        '200':
          description: Successful operation
          content: {}
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
components:
```

## GET `/v1/projects/{name}/logs`

```yaml
paths:
  /v1/projects/{name}/logs:
    get:
      tags:
        - Apps
      summary: Get logs of app
      description: get logs of app that user owns
      operationId: getAppLogs
      parameters:
        - name: name
          in: path
          description: The name of your app
          required: true
          schema:
            type: string
        - name: since
          in: query
          description: Show logs since timestamp
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Successful operation
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Logs'
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
components:
  schemas:
    Logs:
      type: array
      items:
        type: object
        properties:
          type:
            type: string
          datetime:
            type: string
          message:
            type: string
```

## GET `/v1/projects/{name}/events`

```yaml
paths:
  /v1/projects/{name}/events:
    get:
      tags:
        - Apps
      summary: Get events of the app
      description: get events of the app owned by user
      operationId: getAppEvents
      parameters:
        - name: name
          in: path
          description: The name of the app
          required: true
          schema:
            type: string
        - name: search
          in: query
          description: Show events based on search query
          required: false
          schema:
            type: string
        - name: start
          in: query
          description: start timestamp
          example: 1704028315
          required: false
          schema:
            type: number
        - name: end
          in: query
          description: end timestamp
          example: 1704028315
          required: false
          schema:
            type: number
      responses:
        '200':
          description: Successful operation
          content:
            application/json:
              schema:
                required:
                  - data
                type: object
                properties:
                  data:
                    type: array
                    items:
                      type: object
                      properties:
                        metaData:
                          type: object
                        values:
                          type: array
                          items:
                            type: array
                            items:
                              type: string
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
components:
```

## POST `/v2/projects/{name}/sources`

```yaml
paths:
  /v2/projects/{name}/sources:
    post:
      tags:
        - Deploy
      summary: Deploy sources code
      description: deploy sources code that user owns
      operationId: sourcesDeploy
      parameters:
        - name: name
          in: path
          description: The name of your app for deploy
          required: true
          schema:
            type: string
      requestBody:
        content:
          multipart/form-data:
            schema:
              type: object
              required:
                - file
              properties:
                file:
                  type: string
                  format: binary
                  description: The .gz file to deploy
        required: true
      responses:
        '200':
          description: Successful operation
          content:
            application/json:
              schema:
                type: object
                properties:
                  sourceID:
                    type: string
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
components:
```

## POST `/v2/projects/{name}/releases`

```yaml
paths:
  /v2/projects/{name}/releases:
    post:
      tags:
        - Deploy
      summary: Deploy releases
      description: deploy releases that user owns
      operationId: releasesDeploy
      parameters:
        - name: name
          in: path
          description: The name of your app for deploy
          required: true
          schema:
            type: string
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Deploy-releases'
        required: true
      responses:
        '200':
          description: Successful operation
          content:
            application/json:
              schema:
                type: object
                properties:
                  releaseID:
                    type: string
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
components:
  schemas:
    Deploy-releases:
      type: object
      properties:
        sourceID:
          type: string
          description: The id of Deployed sources
        port:
          type: number
          description: The port of your app
        type:
          type: string
          description: The platform of your app
```

## POST `/v1/projects/{id}/zero-downtime/{status}`

```yaml
paths:
  /v1/projects/{id}/zero-downtime/{status}:
    post:
      tags:
        - Settings
      summary: Zero downtime
      description: zero downtime that user owns
      operationId: zeroDowntime
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
        - name: status
          in: path
          description: disable or enable
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Successful operation
          content: {}
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
        '409':
          description: Conflict
          content: {}
components:
```

## POST `/v1/projects/{id}/default-subdomain/{status}`

```yaml
paths:
  /v1/projects/{id}/default-subdomain/{status}:
    post:
      tags:
        - Settings
      summary: Default subdomain
      description: default subdomain that user owns
      operationId: defaultSubdomain
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
        - name: status
          in: path
          description: disable or enable
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Successful operation
          content: {}
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
        '409':
          description: Conflict
          content: {}
components:
```

## POST `/v1/projects/{id}/fixed-ip/{status}`

```yaml
paths:
  /v1/projects/{id}/fixed-ip/{status}:
    post:
      tags:
        - Settings
      summary: IP static
      description: ip static that user owns
      operationId: ipStatic
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
        - name: status
          in: path
          description: disable or enable
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Successful operation
          content:
            application/json:
              schema:
                type: object
                properties:
                  IP:
                    type: string
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
        '409':
          description: Conflict
          content: {}
components:
```

## POST `/v1/projects/{id}/read-only/{status}`

```yaml
paths:
  /v1/projects/{id}/read-only/{status}:
    post:
      tags:
        - Settings
      summary: Read only
      description: read only that user owns
      operationId: readOnly
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
        - name: status
          in: path
          description: disable or enable
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Successful operation
          content: {}
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
        '409':
          description: Conflict
          content: {}
components:
```

## POST `/v1/projects/update-envs`

```yaml
paths:
  /v1/projects/update-envs:
    post:
      tags:
        - Settings
      summary: Update envs
      description: update envs that user owns
      operationId: updateEnvs
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Update-envs'
        required: true
      responses:
        '200':
          description: Successful operation
          content:
            application/json:
              schema:
                type: object
                properties:
                  message:
                    type: string
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
components:
  schemas:
    Update-envs:
      type: object
      properties:
        project:
          type: string
          description: The name of your app for update envs
        variables:
          type: array
          description: The envs for update
          items:
            type: object
            properties:
              key:
                type: string
                description: The name of your env
              value:
                type: string
                description: The value of your env
```

## GET `/v1/projects/{name}/disks/{dname}/ftp`

```yaml
paths:
  /v1/projects/{name}/disks/{dname}/ftp:
    get:
      tags:
        - Disks
      summary: Get ftps
      description: get ftps that user owns
      operationId: getFtps
      parameters:
        - name: name
          in: path
          description: The name of your app
          required: true
          schema:
            type: string
        - name: dname
          in: path
          description: The name of your disk
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Successful operation
          content:
            application/json:
              schema:
                type: object
                properties:
                  accesses:
                    type: array
                    items:
                      type: object
                      properties:
                        _id:
                          type: string
                        disk:
                          type: string
                        username:
                          type: string
                        password:
                          type: string
                        readOnly:
                          type: boolean
                        createdAt:
                          type: string
                          format: date-time
                        __v:
                          type: integer
                  host:
                    type: string
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
components:
```

## POST `/v1/projects/{name}/disks/{dname}/ftp`

```yaml
paths:
  /v1/projects/{name}/disks/{dname}/ftp:
    post:
      tags:
        - Disks
      summary: Create ftp
      description: create ftp that user owns
      operationId: createFtp
      parameters:
        - name: name
          in: path
          description: The name of your app
          required: true
          schema:
            type: string
        - name: dname
          in: path
          description: The name of your disk
          required: true
          schema:
            type: string
      requestBody:
        description: The plan of your app
        content:
          application/json:
            schema:
              required:
                - username
                - readOnly
              type: object
              properties:
                username:
                  type: string
                readOnly:
                  type: boolean
        required: true
      responses:
        '200':
          description: Successful operation
          content:
            application/json:
              schema:
                type: object
                properties:
                  username:
                    type: string
                  password:
                    type: string
                  host:
                    type: string
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
components:
```

## GET `/v1/projects/{id}/disks`

```yaml
paths:
  /v1/projects/{id}/disks:
    get:
      tags:
        - Disks
      summary: Get disks
      description: get disks that user owns
      operationId: getDisks
      parameters:
        - name: id
          in: path
          description: The id of your app
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Successful operation
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Get-disks'
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
components:
  schemas:
    Get-disks:
      type: object
      properties:
        disks:
          type: array
          items:
            properties:
              _id:
                type: string
              name:
                type: string
              size:
                type: integer
              updatedAt:
                type: string
              createdAt:
                type: string
        mounts:
          type: array
          items:
            properties:
              name:
                type: string
              mountedTo:
                type: string
```

## GET `/v1/projects/{id}/disks/{name}/backups`

```yaml
paths:
  /v1/projects/{id}/disks/{name}/backups:
    get:
      tags:
        - Disks
      summary: Get backups disk
      description: get backups disk that user owns
      operationId: getBackups
      parameters:
        - name: id
          in: path
          description: The id of your app
          required: true
          schema:
            type: string
        - name: name
          in: path
          description: The name of your disk
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Successful operation
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Get-disk-backup'
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
components:
  schemas:
    Get-disk-backup:
      type: object
      properties:
        backups:
          type: array
          items:
            type: object
            properties:
              name:
                type: string
              lastModified:
                type: string
              etag:
                type: string
              size:
                type: number
```

## POST `/v1/projects/{id}/disks/{name}/backups`

```yaml
paths:
  /v1/projects/{id}/disks/{name}/backups:
    post:
      tags:
        - Disks
      summary: Create backup disk
      description: create backup disk that user owns
      operationId: createBackup
      parameters:
        - name: id
          in: path
          description: The id of your app
          required: true
          schema:
            type: string
        - name: name
          in: path
          description: The name of your disk
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Successful operation
          content: {}
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
components:
```

## POST `/v1/projects/{id}/disks/{dname}/backups/{bname}/download`

```yaml
paths:
  /v1/projects/{id}/disks/{dname}/backups/{bname}/download:
    post:
      tags:
        - Disks
      summary: Download backup disk
      description: download backup disk that user owns
      operationId: downloadBackup
      parameters:
        - name: id
          in: path
          description: The id of your app
          required: true
          schema:
            type: string
        - name: dname
          in: path
          description: The name of your disk
          required: true
          schema:
            type: string
        - name: bname
          in: path
          description: The name of your backup
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Successful operation
          content:
            application/json:
              schema:
                type: object
                properties:
                  link:
                    type: string
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
components:
```

## POST `/v1/projects/{name}/disks/{dname}/resize`

```yaml
paths:
  /v1/projects/{name}/disks/{dname}/resize:
    post:
      tags:
        - Disks
      summary: Resize disk
      description: resize disk that user owns
      operationId: resizeDisk
      parameters:
        - name: name
          in: path
          description: The name of your app
          required: true
          schema:
            type: string
        - name: dname
          in: path
          description: The name of your disk
          required: true
          schema:
            type: string
      requestBody:
        description: The size of your disk
        content:
          application/json:
            schema:
              required:
                - size
              type: object
              properties:
                size:
                  type: string
        required: true
      responses:
        '200':
          description: Successful operation
          content: {}
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
components:
```

## POST `/v1/projects/{name}/disks`

```yaml
paths:
  /v1/projects/{name}/disks:
    post:
      tags:
        - Disks
      summary: Create a disk
      description: create a disk that user owns
      operationId: createDisk
      parameters:
        - name: name
          in: path
          description: The name of your app
          required: true
          schema:
            type: string
      requestBody:
        description: The disk of your app
        content:
          application/json:
            schema:
              required:
                - name
                - size
              type: object
              properties:
                name:
                  type: string
                size:
                  type: string
        required: true
      responses:
        '201':
          description: Successful operation
          content: {}
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
components:
```

## DELETE `/v1/projects/{id}/disks/{name}`

```yaml
paths:
  /v1/projects/{id}/disks/{name}:
    delete:
      tags:
        - Disks
      summary: Delete a disk
      description: delete a disk that user owns
      operationId: deleteDisk
      parameters:
        - name: id
          in: path
          description: The id of your app
          required: true
          schema:
            type: string
        - name: name
          in: path
          description: The name of your disk of app
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Successful operation
          content: {}
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
        '409':
          description: Conflict
          content: {}
components:
```

## DELETE `/v1/ftp/{fname}`

```yaml
paths:
  /v1/ftp/{fname}:
    delete:
      tags:
        - Disks
      summary: Delete a ftp
      description: delete a ftp that user owns
      operationId: deleteFtp
      parameters:
        - name: fname
          in: path
          description: The name of your ftp
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Successful operation
          content: {}
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
        '409':
          description: Conflict
          content: {}
components:
```

## GET `/v1/projects/{name}/metrics/cpu`

```yaml
paths:
  /v1/projects/{name}/metrics/cpu:
    get:
      tags:
        - Reports
      summary: Get cpu reports of app
      description: get cpu reports of app that user owns
      operationId: getAppCpuReports
      parameters:
        - name: name
          in: path
          description: The name of your app
          required: true
          schema:
            type: string
        - name: since
          in: query
          description: The since of your cpu reports
          required: true
          schema:
            type: number
      responses:
        '200':
          description: Successful operation
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Reports'
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
components:
  schemas:
    Reports:
      type: object
      properties:
        end:
          type: number
        result:
          type: array
          items:
            type: object
            properties:
              values:
                type: array
                items:
                  type: array
                  items:
                    oneOf:
                      - type: number
                      - type: string
              applet:
                type: string
```

## GET `/v1/projects/{name}/metrics/memory`

```yaml
paths:
  /v1/projects/{name}/metrics/memory:
    get:
      tags:
        - Reports
      summary: Get memory reports of app
      description: get memory reports of app that user owns
      operationId: getAppMemoryReports
      parameters:
        - name: name
          in: path
          description: The name of your app
          required: true
          schema:
            type: string
        - name: since
          in: query
          description: The since of your memory reports
          required: true
          schema:
            type: number
      responses:
        '200':
          description: Successful operation
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Reports'
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
components:
  schemas:
    Reports:
      type: object
      properties:
        end:
          type: number
        result:
          type: array
          items:
            type: object
            properties:
              values:
                type: array
                items:
                  type: array
                  items:
                    oneOf:
                      - type: number
                      - type: string
              applet:
                type: string
```

## GET `/v1/projects/{name}/metrics/network-receive`

```yaml
paths:
  /v1/projects/{name}/metrics/network-receive:
    get:
      tags:
        - Reports
      summary: Get network-receive reports of app
      description: get network-receive reports of app that user owns
      operationId: getAppNetworkReceiveReports
      parameters:
        - name: name
          in: path
          description: The name of your app
          required: true
          schema:
            type: string
        - name: since
          in: query
          description: The since of your network-receive reports
          required: true
          schema:
            type: number
      responses:
        '200':
          description: Successful operation
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Reports'
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
components:
  schemas:
    Reports:
      type: object
      properties:
        end:
          type: number
        result:
          type: array
          items:
            type: object
            properties:
              values:
                type: array
                items:
                  type: array
                  items:
                    oneOf:
                      - type: number
                      - type: string
              applet:
                type: string
```

## GET `/v1/projects/{name}/metrics/network-transmit`

```yaml
paths:
  /v1/projects/{name}/metrics/network-transmit:
    get:
      tags:
        - Reports
      summary: Get network-transmit reports of app
      description: get network-transmit reports of app that user owns
      operationId: getNetworkTransmitReports
      parameters:
        - name: name
          in: path
          description: The name of your app
          required: true
          schema:
            type: string
        - name: since
          in: query
          description: The since of your network-transmit reports
          required: true
          schema:
            type: number
      responses:
        '200':
          description: Successful operation
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Reports'
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
components:
  schemas:
    Reports:
      type: object
      properties:
        end:
          type: number
        result:
          type: array
          items:
            type: object
            properties:
              values:
                type: array
                items:
                  type: array
                  items:
                    oneOf:
                      - type: number
                      - type: string
              applet:
                type: string
```

## POST `/v1/domains`

```yaml
paths:
  /v1/domains:
    post:
      tags:
        - Domains
      summary: Create a domain
      description: create a domain that user owns
      operationId: createAppDomain
      requestBody:
        description: The domain of your app
        content:
          application/json:
            schema:
              required:
                - name
                - project
                - type
              type: object
              properties:
                name:
                  type: string
                project:
                  type: string
                type:
                  type: string
                  default: PROJECT
        required: true
      responses:
        '201':
          description: Successful operation
          content:
            application/json:
              schema:
                type: object
                properties:
                  domain:
                    type: object
                    properties:
                      _id:
                        type: string
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App does not exists.
          content: {}
        '409':
          description: Conflict
          content: {}
components:
```

## POST `/v1/domains/set-project`

```yaml
paths:
  /v1/domains/set-project:
    post:
      tags:
        - Domains
      summary: Set a domain for project
      description: set a domain for project that user owns
      operationId: setAppDomain
      requestBody:
        description: The domain of your app
        content:
          application/json:
            schema:
              required:
                - domainID
                - projectID
              type: object
              properties:
                domainID:
                  type: string
                projectID:
                  type: string
        required: true
      responses:
        '200':
          description: Successful operation
          content: {}
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: App or domain does not exists.
          content: {}
components:
```

## POST `/v1/domains/{id}/set-redirect`

```yaml
paths:
  /v1/domains/{id}/set-redirect:
    post:
      tags:
        - Domains
      summary: Redirect a domain
      description: redirect a domain that user owns
      operationId: redirectDomain
      parameters:
        - name: id
          in: path
          description: The id of your domain
          required: true
          schema:
            type: string
      requestBody:
        description: The domain of your app
        content:
          application/json:
            schema:
              required:
                - redirectStatus
                - redirectTo
              type: object
              properties:
                redirectStatus:
                  type: number
                  description: 302 or 301
                redirectTo:
                  type: string
        required: true
      responses:
        '200':
          description: Successful operation
          content: {}
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: Domain does not exists.
          content: {}
components:
```

## POST `/v1/domains/{id}/ssl/disable`

```yaml
paths:
  /v1/domains/{id}/ssl/disable:
    post:
      tags:
        - Domains
      summary: Disable ssl
      description: disable ssl that user owns
      operationId: disableSsl
      parameters:
        - name: id
          in: path
          description: The id of your domain
          required: true
          schema:
            type: string
      responses:
        '204':
          description: Successful operation
          content: {}
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: Domain does not exists.
          content: {}
components:
```

## POST `/v1/domains/provision-ssl-certs`

```yaml
paths:
  /v1/domains/provision-ssl-certs:
    post:
      tags:
        - Domains
      summary: Enable ssl
      description: enable ssl that user owns
      operationId: enableSsl
      requestBody:
        description: The domain of your app
        content:
          application/json:
            schema:
              required:
                - domain
              type: object
              properties:
                domain:
                  type: string
        required: true
      responses:
        '200':
          description: Successful operation
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: string
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: Domain does not exists.
          content: {}
components:
```

## DELETE `/v1/domains/{id}`

```yaml
paths:
  /v1/domains/{id}:
    delete:
      tags:
        - Domains
      summary: Delete a domain
      description: delete a domain that user owns
      operationId: deleteDomain
      parameters:
        - name: id
          in: path
          description: The id of your domain
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Successful operation
          content: {}
        '400':
          description: Bad request
          content: {}
        '401':
          description: Missing authentication
          content: {}
        '404':
          description: Domain does not exists.
          content: {}
components:
```
