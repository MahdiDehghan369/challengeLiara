> ## Documentation Index
> Fetch the complete documentation index at: https://developers.liara.ir/llms.txt
> Use this file to discover all available pages before exploring further.

# Check a domain

> check a domain that user owns



## OpenAPI

````yaml /spec/paas.yaml get /v1/domains/{id}/check
openapi: 3.0.1
info:
  title: PaaS
  description: >-
    Manage your apps using our API


    [wss://api.liara.ir?token=<api-token>&cmd=/bin/bash&project_id=<project-id>](

    wss://api.liara.ir?token=<api-token>&cmd=/bin/bash&project_id=<project-id>)


    Parameters:

    - `token`: Your api token in liara

    - `cmd`: By default /bin/bash

    - `project_id`: The id of your project in liara

    - `teamID`: To access services in a team


    This `WebSocket` endpoint allows `real-time`

    communication with the projects service hosted

    at `Liara` You can use `WebSocket protocols`

    to send and receive data, enabling efficient and

    low-latency interactions with the projects
  termsOfService: '#'
  contact:
    email: info@liara.ir
  version: 1.0.0
servers:
  - url: https://api.liara.ir
security:
  - jwt: []
  - bearerAuth: []
tags:
  - name: Apps
    description: Everything about your Apps
  - name: Deploy
    description: Deploy endpoints
  - name: Settings
    description: Settings of your app
  - name: Disks
    description: Disks of your app
  - name: Domains
    description: Domains of your app
  - name: Reports
    description: Reports of your app
externalDocs:
  description: Find out more about PaaS
  url: http://liara.ir
paths:
  /v1/domains/{id}/check:
    get:
      tags:
        - Domains
      summary: Check a domain
      description: check a domain that user owns
      operationId: checkDomain
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
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CheckDomain'
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
  schemas:
    CheckDomain:
      type: object
      properties:
        domain:
          type: object
          properties:
            _id:
              type: string
            user:
              type: string
            name:
              type: string
            type:
              type: string
            project:
              type: object
              properties:
                _id:
                  type: string
                project_id:
                  type: string
            status:
              type: string
            certificatesStatus:
              type: string
            redirectTo:
              type: string
            redirectStatus:
              type: number
            updated_at:
              type: string
            punycodeName:
              type: string
            verificationCode:
              type: string
            created_at:
              type: string
            __v:
              type: number
            CNameRecord:
              type: string
            issuedAt:
              type: string
  securitySchemes:
    jwt:
      type: apiKey
      name: Authorization
      in: header
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.