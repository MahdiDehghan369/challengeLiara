import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { loadConfig, type Config } from '../../config/env.js';
import type { PipelineEvent } from '../../deploy/pipeline-engine.js';
import type { CodeFixRouter } from '../../sre/execute-fix.js';
import { defaultAppUrl } from '../../deploy/steps/verify.js';
import { createLiaraClient, type LiaraClient } from '../../liara/index.js';
import { createLlm } from '../../llm/index.js';
import type { LlmClient } from '../../llm/types.js';
import { PlanCatalog } from '../../planner/plans.js';
import type { Approver } from '../../safety/approval.js';
import { AuditLog } from '../../safety/audit.js';
import { loadPolicy, type Policy } from '../../safety/policy.js';
import { deployTools, manageTools, opsTools, readTools, sreTools, ToolRegistry } from '../../tools/index.js';
import { CliApprover, ClackPrompter, type Prompter } from './approver.js';

/**
 * What the CLI commands need (T9.2), behind one interface so tests inject a mock world and capture
 * output. Services are created lazily: `siavash --help` never reads config or touches Liara.
 */

export interface CliServices {
  config: Readonly<Config>;
  liara: LiaraClient;
  llm: LlmClient;
  registry: ToolRegistry;
  audit: AuditLog;
  policy: Policy;
  urlFor: (app: string) => string | Promise<string>;
  /** Where pipeline step events go while a command runs (the live checklist). */
  pipelineEvents: { sink?: (e: PipelineEvent) => void };
}

export interface CliRuntime {
  out(text: string): void;
  err(text: string): void;
  ui: Prompter;
  approver(opts: { yes?: boolean }): Approver;
  /** Created on first use; the first caller's options win (one command per process). */
  services(opts?: { yes?: boolean; deployMode?: 'cli' | 'api' }): Promise<CliServices>;
  /** `~/.siavash/credentials` (token from `siavash login`). */
  credentialsPath: string;
  cwd: string;
  /** stdout is a terminal (live redraw allowed). */
  isTTY: boolean;
}

// ---- credentials ------------------------------------------------------------

const CredentialsSchema = z.object({ token: z.string().min(1), teamId: z.string().min(1).optional() });
export type Credentials = z.infer<typeof CredentialsSchema>;

export const defaultCredentialsPath = (): string => join(homedir(), '.siavash', 'credentials');

export function readCredentials(path: string): Credentials | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = CredentialsSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Writes the token file with mode 600 (owner only). On Windows the mode is best effort. */
export function writeCredentials(path: string, creds: Credentials): void {
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(creds)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // not supported on this filesystem
  }
}

/** `.env` + process env first; the credentials file only fills a missing token / team id. */
export function loadCliConfig(credentialsPath: string, env: NodeJS.ProcessEnv = process.env): Readonly<Config> {
  const creds = readCredentials(credentialsPath);
  return loadConfig({
    ...env,
    ...(creds && !env.LIARA_API_TOKEN ? { LIARA_API_TOKEN: creds.token } : {}),
    ...(creds?.teamId && !env.LIARA_TEAM_ID ? { LIARA_TEAM_ID: creds.teamId } : {}),
  });
}

// ---- registry ---------------------------------------------------------------

export function buildCliRegistry(input: {
  config: Pick<Config, 'liara' | 'deployMode' | 'dataDir'>;
  liara: LiaraClient;
  ui: Prompter;
  urlFor: (app: string) => string | Promise<string>;
  yes?: boolean;
  onPipelineEvent?: (e: PipelineEvent) => void;
  /** Code fixes inside the doctor (T8.15 router). */
  codeFix?: CodeFixRouter;
}): ToolRegistry {
  const catalog = new PlanCatalog(input.liara.cli);
  const registry = new ToolRegistry();
  const tools = [
    ...readTools(),
    ...opsTools({ catalog, urlFor: input.urlFor }),
    ...manageTools(),
    ...deployTools({ config: input.config, ui: input.ui, ...(input.yes ? { yes: true } : {}), ...(input.onPipelineEvent ? { onPipelineEvent: input.onPipelineEvent } : {}) }),
    ...sreTools({
      urlFor: input.urlFor,
      catalog,
      dataDir: input.config.dataDir,
      doctor: { ui: input.ui, catalog, reportsDir: join(input.config.dataDir, 'reports'), ...(input.codeFix ? { codeFix: input.codeFix } : {}) },
    }),
  ];
  for (const t of tools) registry.register(t);
  return registry;
}

export function createRuntime(): CliRuntime {
  const ui = new ClackPrompter();
  const credentialsPath = defaultCredentialsPath();
  let services: CliServices | undefined;
  return {
    out: (t) => process.stdout.write(`${t}\n`),
    err: (t) => process.stderr.write(`${t}\n`),
    ui,
    credentialsPath,
    cwd: process.cwd(),
    isTTY: process.stdout.isTTY === true,
    approver: ({ yes }) => new CliApprover({ prompter: ui, ...(yes ? { yes: true } : {}) }),
    services: async (opts = {}) => {
      if (services) return services;
      dotenv.config({ quiet: true });
      const config = loadCliConfig(credentialsPath, { ...process.env, ...(opts.deployMode ? { DEPLOY_MODE: opts.deployMode } : {}) });
      const liara = createLiaraClient(config);
      const urlFor = (app: string) => (liara.mock ? liara.mock.servers.urlFor(app) : defaultAppUrl(app));
      const pipelineEvents: CliServices['pipelineEvents'] = {};
      services = {
        config,
        liara,
        llm: createLlm(config),
        registry: buildCliRegistry({ config, liara, ui, urlFor, ...(opts.yes ? { yes: true } : {}), onPipelineEvent: (e) => pipelineEvents.sink?.(e) }),
        pipelineEvents,
        audit: new AuditLog(config.dataDir),
        policy: loadPolicy(),
        urlFor,
      };
      return services;
    },
  };
}
