import type { Config } from '../config/env.js';
import { AccountApi } from './api/account.js';
import { AppsApi } from './api/apps.js';
import { BillingApi } from './api/billing.js';
import { DeployApi } from './api/deploy.js';
import { DisksApi } from './api/disks.js';
import { DomainsApi } from './api/domains.js';
import { EventsApi } from './api/events.js';
import { LogsApi } from './api/logs.js';
import { MetricsApi } from './api/metrics.js';
import { SettingsApi } from './api/settings.js';
import { LiaraCli } from './cli.js';
import { LiaraConsole } from './console.js';
import { DbApi } from './db.js';
import { EnvApi, type EnvApiOptions } from './env.js';
import { LiaraHttp, type HttpStats } from './http.js';
import { DeploymentLedger } from './ledger.js';
import { MockAppServers } from './mock/app-server.js';
import { createCliMock } from './mock/cli-mock.js';
import { createConsoleMock } from './mock/console-mock.js';
import { createMockFetch } from './mock/handlers.js';
import { MockLiaraState, type MockStateOptions } from './mock/state.js';

/**
 * The single entry point to Liara (T1.17). Modules outside `src/liara` use this facade (or types from
 * the `liara/index.js` barrel) — never `liara/api/*` directly (enforced by eslint `no-restricted-imports`).
 * `mode: 'mock'` swaps in the stateful fake Liara (T1.16) for REST, CLI and console alike.
 */
export interface LiaraClient {
  mode: 'live' | 'mock';
  apps: AppsApi;
  metrics: MetricsApi;
  logs: LogsApi;
  events: EventsApi;
  deploy: DeployApi;
  ledger: DeploymentLedger;
  env: EnvApi;
  settings: SettingsApi;
  billing: BillingApi;
  account: AccountApi;
  disks: DisksApi;
  domains: DomainsApi;
  db: DbApi;
  console: LiaraConsole;
  cli: LiaraCli;
  stats: () => Readonly<HttpStats>;
  /** Mock mode only: the fake Liara state and the local app servers (for probes and scenario injection). */
  mock?: { state: MockLiaraState; servers: MockAppServers };
}

export interface CreateLiaraClientOptions {
  /** Rate guard hook (T2.6), called before every HTTP attempt. */
  onRequest?: (operationId: string) => void;
  env?: EnvApiOptions;
  /** Mock mode: reuse an existing state or configure a new one. */
  mockState?: MockLiaraState;
  mockOptions?: MockStateOptions;
}

const MOCK_TOKEN = 'mock-token';

export function createLiaraClient(
  config: Pick<Config, 'liara' | 'dataDir'>,
  opts: CreateLiaraClientOptions = {},
): LiaraClient {
  const mode = config.liara.mode;
  const teamId = config.liara.teamId;
  const state = mode === 'mock' ? (opts.mockState ?? new MockLiaraState(opts.mockOptions)) : undefined;
  const token = state ? (config.liara.token ?? MOCK_TOKEN) : (config.liara.token ?? '');

  const http = new LiaraHttp({
    token,
    teamId,
    ...(state ? { fetchImpl: createMockFetch(state), sleep: async () => {} } : {}),
    ...(opts.onRequest ? { onRequest: opts.onRequest } : {}),
  });
  const cli = new LiaraCli({ token, teamId, ...(state ? { spawner: createCliMock(state) } : {}) });
  const apps = new AppsApi(http);

  return {
    mode,
    apps,
    metrics: new MetricsApi(http),
    logs: new LogsApi(http, { cli }),
    events: new EventsApi(http),
    deploy: new DeployApi(http),
    ledger: new DeploymentLedger({ dataDir: config.dataDir }),
    env: new EnvApi(http, cli, opts.env ?? {}),
    settings: new SettingsApi(http, apps),
    billing: new BillingApi(http),
    account: new AccountApi(apps),
    disks: new DisksApi(http, apps),
    domains: new DomainsApi(http, apps),
    db: new DbApi(cli, http),
    console: new LiaraConsole({ token, teamId, apps, cli, ...(state ? { socketFactory: createConsoleMock(state) } : {}) }),
    cli,
    stats: () => http.getStats(),
    ...(state ? { mock: { state, servers: new MockAppServers(state) } } : {}),
  };
}
