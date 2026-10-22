import { randomBytes } from 'node:crypto';

/**
 * In-memory "fake Liara" (T1.16). One state object backs the REST handlers, the CLI mock, the console
 * mock and the per-app HTTP server, so every path sees the same apps, envs, releases, logs and metrics.
 * Behaviours that are still open questions follow the conservative choice and are configurable:
 * env update semantics (OQ-19), whether env updates restart the app, async delays (BEHAVIOR §8).
 */

export type ScenarioKind =
  | 'missing-env'
  | 'crash-loop'
  | 'oom'
  | 'http-500'
  | 'slow'
  | 'bad-release'
  | 'db-connection'
  | 'disk-full';

export const SCENARIOS: readonly ScenarioKind[] = [
  'missing-env',
  'crash-loop',
  'oom',
  'http-500',
  'slow',
  'bad-release',
  'db-connection',
  'disk-full',
];

/** Plan catalog in the shape recorded from `liara plan:list` (T0.5, OQ-5); RAM/Disk in GB. */
export const MOCK_PLANS = [
  { Plan: 'small-g2', RAM: '0.5', CPU: '0.5', Disk: '5', Price: '474,998.4', Free: '0', Standard: '275,000', Pro: '475,000' },
  { Plan: 'medium-g2', RAM: '1', CPU: '1', Disk: '10', Price: '824,997.6', Free: '0', Standard: '475,000', Pro: '825,000' },
  { Plan: 'standard-base-g2', RAM: '2', CPU: '1', Disk: '20', Price: '1,474,999.2', Free: '0', Standard: '825,000', Pro: '1,475,000' },
  { Plan: 'standard-plus-g2', RAM: '4', CPU: '2', Disk: '40', Price: '2,649,996', Free: '0', Standard: '1,475,000', Pro: '2,650,000' },
  { Plan: 'pro-g2', RAM: '8', CPU: '4', Disk: '80', Price: '4,599,993.6', Free: '0', Standard: '2,650,000', Pro: '4,600,000' },
] as const;

export function planRamMb(planID: string): number {
  const p = MOCK_PLANS.find((x) => x.Plan === planID);
  return p ? Number(p.RAM) * 1024 : 512;
}

export interface MockLogRow {
  ts: number;
  type: 'stdout' | 'stderr';
  message: string;
}

export interface MockRelease {
  id: string;
  version: number;
  sourceID: string;
  port: number;
  type: string;
  createdAt: number;
  /** A release built from a broken source crashes on start. */
  broken: boolean;
  via: 'api' | 'cli';
}

export interface MockDisk {
  _id: string;
  name: string;
  size: number;
  usage: number;
  mountedTo?: string;
  createdAt: string;
}

export interface MockFtp {
  _id: string;
  username: string;
  password: string;
  readOnly: boolean;
  disk: string;
}

export interface MockApp {
  id: string;
  name: string;
  platform: string;
  planID: string;
  status: string;
  scale: 0 | 1;
  isDeployed: boolean;
  createdAt: string;
  envs: Map<string, string>;
  settings: { zeroDowntime: boolean; defaultSubdomain: boolean; fixedIp: string | undefined; readOnly: boolean };
  sources: Map<string, { size: number; broken: boolean }>;
  releases: MockRelease[];
  logs: MockLogRow[];
  events: Array<{ ts: number; text: string }>;
  disks: MockDisk[];
  backups: Map<string, Array<{ name: string; lastModified: string; etag: string; size: number }>>;
  ftp: MockFtp[];
  scenario: ScenarioKind | undefined;
  /** Env key the app needs at start (missing-env scenario). */
  requiredEnv: string | undefined;
}

export interface MockDomain {
  _id: string;
  name: string;
  type: string;
  project: string | undefined;
  status: string;
  certificatesStatus: string;
  redirectTo: string | null;
  redirectStatus: number | null;
  created_at: string;
  CNameRecord: string;
}

export interface MockDatabase {
  name: string;
  type: string;
  plan: string;
  status: 'RUNNING' | 'STOPPED';
}

export interface MockStateOptions {
  /** Delay before async actions take effect (ms). */
  asyncDelayMs?: number;
  /** OQ-19: what `update-envs` does with keys it does not receive. */
  envSemantics?: 'replace' | 'merge';
  /** OQ-19: whether `update-envs` restarts the app. */
  envUpdateRestarts?: boolean;
  now?: () => number;
}

const hex = (n: number) => randomBytes(n).toString('hex');

export class MockLiaraState {
  readonly apps = new Map<string, MockApp>();
  readonly domains: MockDomain[] = [];
  readonly databases: MockDatabase[] = [];
  /** Zones on Liara DNS (for `liara zone check`). */
  readonly zones = new Set<string>();
  billing = { balance: 5_000_000, accountType: 'REAL_PERSON', minCreditAmount: 20_000, isManualMinCredit: false };
  /** Next CLI/API deploy fails at build (to simulate a broken build). */
  nextDeployFails = false;
  readonly asyncDelayMs: number;
  readonly envSemantics: 'replace' | 'merge';
  readonly envUpdateRestarts: boolean;
  readonly now: () => number;
  private readonly pending = new Set<Promise<void>>();

  constructor(opts: MockStateOptions = {}) {
    this.asyncDelayMs = opts.asyncDelayMs ?? 30;
    this.envSemantics = opts.envSemantics ?? 'replace';
    this.envUpdateRestarts = opts.envUpdateRestarts ?? true;
    this.now = opts.now ?? Date.now;
  }

  // ---- async ----------------------------------------------------------------

  /** Runs `fn` after the async delay (Liara "accepted" semantics). */
  later(fn: () => void): void {
    const p = new Promise<void>((resolve) => {
      setTimeout(() => {
        try {
          fn();
        } finally {
          resolve();
        }
      }, this.asyncDelayMs);
    });
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }

  /** Waits until every scheduled async action has applied. */
  async settle(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  // ---- apps -----------------------------------------------------------------

  createApp(input: { name: string; planID: string; platform: string; readOnly?: boolean }): MockApp {
    const app: MockApp = {
      id: hex(12),
      name: input.name,
      platform: input.platform,
      planID: input.planID,
      status: 'ACTIVE',
      scale: 1,
      isDeployed: false,
      createdAt: new Date(this.now()).toISOString(),
      envs: new Map(),
      settings: { zeroDowntime: false, defaultSubdomain: true, fixedIp: undefined, readOnly: !!input.readOnly },
      sources: new Map(),
      releases: [],
      logs: [],
      events: [],
      disks: [],
      backups: new Map(),
      ftp: [],
      scenario: undefined,
      requiredEnv: undefined,
    };
    this.apps.set(app.name, app);
    this.event(app, 'App created');
    return app;
  }

  findById(id: string): MockApp | undefined {
    return [...this.apps.values()].find((a) => a.id === id);
  }

  /** Resolves `{name}` or `{id}` path params. */
  find(nameOrId: string): MockApp | undefined {
    return this.apps.get(nameOrId) ?? this.findById(nameOrId);
  }

  log(app: MockApp, message: string, type: MockLogRow['type'] = 'stdout'): void {
    app.logs.push({ ts: this.now(), type, message });
    if (app.logs.length > 5000) app.logs.splice(0, app.logs.length - 5000);
  }

  event(app: MockApp, text: string): void {
    app.events.push({ ts: this.now(), text });
  }

  currentRelease(app: MockApp): MockRelease | undefined {
    return app.releases[app.releases.length - 1];
  }

  /** Simulates a (re)start: either healthy boot logs or the scenario's crash output. */
  start(app: MockApp, reason: string): void {
    this.event(app, reason);
    if (app.scale === 0) return;
    const crash = this.crashOutput(app);
    if (crash) {
      for (const l of crash) this.log(app, l, 'stderr');
      this.event(app, app.scenario === 'oom' ? 'OOMKilled: container exceeded memory limit' : 'Back-off restarting failed container');
      return;
    }
    this.log(app, `${app.name} listening on port ${this.currentRelease(app)?.port ?? 3000}`);
  }

  restart(app: MockApp): void {
    this.later(() => this.start(app, 'App restarted'));
  }

  setScale(app: MockApp, scale: 0 | 1): void {
    this.later(() => {
      app.scale = scale;
      app.status = scale === 1 ? 'ACTIVE' : 'STOPPED';
      if (scale === 1) this.start(app, 'App scaled to 1');
      else this.event(app, 'App scaled to 0 (stopped)');
    });
  }

  resize(app: MockApp, planID: string): void {
    this.later(() => {
      app.planID = planID;
      if (app.scenario === 'oom' || app.scenario === 'slow') this.resolve(app);
      this.start(app, `Plan changed to ${planID}; app restarted`);
    });
  }

  deleteApp(app: MockApp): void {
    this.later(() => {
      this.apps.delete(app.name);
      for (const d of this.domains) if (d.project === app.name) d.project = undefined;
    });
  }

  // ---- env ------------------------------------------------------------------

  updateEnvs(app: MockApp, vars: Array<{ key: string; value: string }>): void {
    if (this.envSemantics === 'replace') app.envs.clear();
    for (const v of vars) app.envs.set(v.key, v.value);
    this.afterEnvChange(app);
  }

  unsetEnvs(app: MockApp, keys: string[]): void {
    for (const k of keys) app.envs.delete(k);
    this.afterEnvChange(app);
  }

  private afterEnvChange(app: MockApp): void {
    this.event(app, 'Environment variables updated');
    if (app.scenario === 'missing-env' && app.requiredEnv && app.envs.get(app.requiredEnv)) this.resolve(app);
    if (app.scenario === 'db-connection') {
      const url = app.envs.get('DATABASE_URL') ?? '';
      if (url && !/localhost|127\.0\.0\.1|::1/.test(url)) this.resolve(app);
    }
    if (this.envUpdateRestarts) this.restart(app);
  }

  // ---- deploy ---------------------------------------------------------------

  addSource(app: MockApp, size: number): string {
    const id = hex(12);
    app.sources.set(id, { size, broken: this.nextDeployFails });
    return id;
  }

  /** Creates a release; resolves code-level scenarios (a fresh source = a code fix, an old one = rollback). */
  createRelease(app: MockApp, input: { sourceID: string; port: number; type: string }, via: 'api' | 'cli'): MockRelease {
    const source = app.sources.get(input.sourceID);
    const previous = this.currentRelease(app);
    const release: MockRelease = {
      id: hex(12),
      version: app.releases.length + 1,
      sourceID: input.sourceID,
      port: input.port,
      type: input.type,
      createdAt: this.now(),
      broken: source?.broken ?? false,
      via,
    };
    app.releases.push(release);
    this.event(app, `Deployment started (release v${release.version})`);
    const isRollback = !!previous && app.releases.slice(0, -1).some((r) => r.sourceID === input.sourceID);
    this.later(() => {
      if (release.broken) {
        this.log(app, 'Build failed: npm run build exited with code 1', 'stderr');
        this.event(app, `Deployment failed (release v${release.version})`);
        return;
      }
      app.isDeployed = true;
      if (app.scenario === 'bad-release' && isRollback) this.resolve(app);
      else if (['crash-loop', 'http-500', 'slow'].includes(app.scenario ?? '')) this.resolve(app);
      this.event(app, `Release v${release.version} deployed`);
      this.start(app, 'App started with the new release');
    });
    return release;
  }

  // ---- disks ----------------------------------------------------------------

  resizeDisk(app: MockApp, disk: MockDisk, size: number): void {
    disk.size = size;
    if (app.scenario === 'disk-full' && disk.usage / disk.size < 0.8) this.resolve(app);
    this.event(app, `Disk ${disk.name} resized to ${size}GB`);
  }

  // ---- scenarios ------------------------------------------------------------

  /**
   * Puts the app into a failure scenario: writes matching logs/events now; metrics and the probe
   * server reflect it until the right fix resolves it.
   */
  injectScenario(appName: string, kind: ScenarioKind): void {
    const app = this.apps.get(appName);
    if (!app) throw new Error(`mock: no app ${appName}`);
    app.scenario = kind;
    if (kind === 'missing-env') {
      app.requiredEnv = 'DATABASE_URL';
      app.envs.delete('DATABASE_URL');
    }
    if (kind === 'db-connection') app.envs.delete('DATABASE_URL');
    if (kind === 'bad-release') {
      // two releases: a good one and the broken current one
      const good = this.addSource(app, 1024);
      app.releases.push({ id: hex(12), version: app.releases.length + 1, sourceID: good, port: 3000, type: app.platform, createdAt: this.now() - 3_600_000, broken: false, via: 'api' });
      const bad = hex(12);
      app.sources.set(bad, { size: 1024, broken: false });
      app.releases.push({ id: hex(12), version: app.releases.length + 1, sourceID: bad, port: 3000, type: app.platform, createdAt: this.now(), broken: false, via: 'api' });
      this.event(app, `Release v${app.releases.length} deployed`);
    }
    if (kind === 'disk-full') {
      if (app.disks.length === 0) app.disks.push({ _id: hex(12), name: 'data', size: 1, usage: 0, mountedTo: '/app/data', createdAt: new Date(this.now()).toISOString() });
      for (const d of app.disks) d.usage = d.size * 0.99;
    }
    const scenarioLogs = this.runtimeOutput(app);
    for (const l of scenarioLogs) this.log(app, l, 'stderr');
    this.start(app, 'App restarted');
  }

  /** Marks the scenario as fixed. */
  resolve(app: MockApp): void {
    if (!app.scenario) return;
    this.event(app, `Recovered from ${app.scenario}`);
    app.scenario = undefined;
    app.requiredEnv = undefined;
  }

  /** Lines printed when the app crashes on start, or undefined when it boots. */
  crashOutput(app: MockApp): string[] | undefined {
    const current = this.currentRelease(app);
    if (current?.broken) return ['Error: Cannot find module \'/app/dist/index.js\''];
    switch (app.scenario) {
      case 'missing-env':
        return [
          'TypeError [ERR_INVALID_URL]: Invalid URL',
          '    at new URL (node:internal/url:816:29)',
          '    at Object.<anonymous> (/app/index.js:4:15)',
        ];
      case 'crash-loop':
        return ["Error: Cannot find module './config'", '    at Object.<anonymous> (/app/src/server.js:3:16)'];
      case 'bad-release':
        return ["Error: Cannot find module './lib/checkout-utlis'", '    at Object.<anonymous> (/app/index.js:4:27)'];
      case 'db-connection':
        return ['Error: connect ECONNREFUSED 127.0.0.1:5432', '    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1611:16)'];
      case 'oom':
        return ['<--- Last few GCs --->', 'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory'];
      default:
        return undefined;
    }
  }

  /** Errors the app logs while running (non-crash scenarios). */
  private runtimeOutput(app: MockApp): string[] {
    switch (app.scenario) {
      case 'http-500':
        return [
          "TypeError: Cannot read properties of undefined (reading 'length')",
          '    at summarize (/app/src/orders.js:14:29)',
          '    at Server.<anonymous> (/app/src/server.js:20:31)',
        ];
      case 'disk-full':
        return ["Error: ENOSPC: no space left on device, write '/app/data/uploads.db'"];
      case 'slow':
        return ['WARN request GET /api/report took 4210ms'];
      default:
        return [];
    }
  }

  /** How the app answers HTTP right now (used by the app server). */
  httpBehaviour(app: MockApp, path: string): { status: number; body: string; delayMs: number } {
    if (app.scale === 0) return { status: 503, body: 'Application is stopped', delayMs: 0 };
    if (!app.isDeployed && app.releases.length === 0) return { status: 502, body: 'No release deployed', delayMs: 0 };
    if (this.crashOutput(app)) return { status: 502, body: 'Bad Gateway: application crashed', delayMs: 0 };
    if (path === '/health' || path === '/healthz') return { status: 200, body: '{"status":"ok"}', delayMs: 0 };
    if (app.scenario === 'http-500') return { status: 500, body: '{"error":"internal error"}', delayMs: 0 };
    if (app.scenario === 'slow') return { status: 200, body: '{"ok":true}', delayMs: 400 };
    if (app.scenario === 'disk-full' && /upload|write/.test(path)) return { status: 500, body: '{"error":"ENOSPC"}', delayMs: 0 };
    return { status: 200, body: `{"app":"${app.name}","ok":true}`, delayMs: 0 };
  }

  /** CPU (cores used) and memory (bytes) for a point in time, shaped by the scenario. */
  metricAt(app: MockApp, t: number): { cpu: number; memBytes: number; rx: number; tx: number } {
    const ramMb = planRamMb(app.planID);
    const wobble = (Math.sin(t / 60_000) + 1) / 2;
    let cpu = 0.05 + 0.05 * wobble;
    let memMb = ramMb * (0.3 + 0.05 * wobble);
    if (app.scenario === 'oom') memMb = ramMb * (0.97 + 0.03 * wobble);
    if (app.scenario === 'slow') cpu = 0.95 + 0.04 * wobble;
    if (app.scale === 0) {
      cpu = 0;
      memMb = 0;
    }
    return { cpu, memBytes: Math.round(memMb * 1024 * 1024), rx: 2000 + 500 * wobble, tx: 3000 + 500 * wobble };
  }
}
