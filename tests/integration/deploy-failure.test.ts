import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { handleDeployFailure, runRedeploy, type OnFailureDeps } from '../../src/deploy/index.js';
import { createLiaraClient, type DeployFault, type LiaraClient } from '../../src/liara/index.js';
import { PlanCatalog } from '../../src/planner/plans.js';
import { ScriptedApprover } from '../../src/safety/approval.js';
import { AuditLog } from '../../src/safety/audit.js';
import { Risk } from '../../src/safety/risk.js';
import { ScriptedUi, type ScriptedAnswer } from '../../src/ui/cli/scripted-ui.js';
import { noKeepAlive } from '../helpers/no-pool-fetch.js';

const DEMOS = join(import.meta.dirname, '..', '..', 'demo-apps');
const root = mkdtempSync(join(tmpdir(), 'siavash-deploy-failure-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let open: LiaraClient[] = [];
afterEach(async () => {
  await Promise.all(open.map((c) => c.mock!.servers.close()));
  open = [];
});
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const SECRET_DB = 'postgres://app:db-pass-123@shop-db.internal:5432/shop';

async function world(opts: { demo?: string; healthyPrevious?: boolean } = {}) {
  const dataDir = join(mkdtempSync(join(root, 'd-')), 'data');
  const dir = join(mkdtempSync(join(root, 'p-')), 'app');
  cpSync(join(DEMOS, opts.demo ?? 'node-express-ok'), dir, { recursive: true, filter: (src) => !src.split(sep).includes('node_modules') });
  const liara = createLiaraClient({ liara: { token: undefined, teamId: undefined, mode: 'mock' }, dataDir }, { mockOptions: { asyncDelayMs: 1 } });
  open.push(liara);
  const mock = liara.mock!.state;
  const app = mock.createApp({ name: 'shop', planID: 'small-g2', platform: 'node' });
  if (opts.healthyPrevious) {
    const sourceID = mock.addSource(app, 1024);
    mock.createRelease(app, { sourceID, port: 3000, type: 'node' }, 'api');
    await mock.settle();
    liara.ledger.record({ app: 'shop', mode: 'api', sourceID, port: 3000, platform: 'node', result: 'success', startedAt: new Date(Date.now() - 3_600_000).toISOString() });
  }
  const approver = new ScriptedApprover(['approved']);
  let deploys = 0;
  const redeploy = () => {
    deploys++;
    return runRedeploy(dir, {
      config: { liara: { token: undefined, teamId: undefined, mode: 'mock' }, deployMode: 'cli' },
      liara,
      ui: new ScriptedUi([]),
      ops: { approver },
      app: 'shop',
      urlFor: (n) => liara.mock!.servers.urlFor(n),
      probe: { count: 2, timeoutMs: 5000, fetchImpl: noKeepAlive },
      wait: { timeoutMs: 1500, intervalMs: 2, sleep: realSleep },
      observeMs: 0,
      cliTimeoutMs: 300,
    });
  };
  return { liara, mock, dataDir, dir, approver, redeploy, deploys: () => deploys };
}

function failureDeps(w: Awaited<ReturnType<typeof world>>, answers: ScriptedAnswer[]): { deps: OnFailureDeps; ui: ScriptedUi } {
  const ui = new ScriptedUi(answers);
  const ops = { approver: w.approver, audit: new AuditLog(w.dataDir) };
  return {
    ui,
    deps: {
      liara: w.liara,
      ui,
      ops,
      redeploy: w.redeploy,
      urlFor: (n) => w.liara.mock!.servers.urlFor(n),
      probe: { count: 1, timeoutMs: 5000, fetchImpl: noKeepAlive },
      wait: { intervalMs: 5, sleep: realSleep },
      waitMoreMs: 3000,
      reportsDir: join(w.dataDir, '..', 'reports'),
      dataDir: w.dataDir,
      doctor: {
        catalog: new PlanCatalog(w.liara.cli),
        snapshot: { urlFor: (n) => w.liara.mock!.servers.urlFor(n), probe: { count: 2, timeoutMs: 5000, fetchImpl: noKeepAlive }, units: { cpu: 'cores', memory: 'bytes' }, dataDir: w.dataDir },
        verify: { settleMs: 30, snapshots: 1, sleep: realSleep },
        wait: { timeoutMs: 2000, intervalMs: 2, sleep: realSleep },
      },
    },
  };
}

async function failWith(w: Awaited<ReturnType<typeof world>>, fault: DeployFault | 'build') {
  if (fault === 'build') w.mock.nextDeployFails = true;
  else w.mock.nextDeployFault = fault;
  const first = await w.redeploy();
  expect(first.status).toBe('failed');
  return first;
}

describe('deploy failure decision machine (T5.11)', { timeout: 120_000 }, () => {
  it('upload-error → retry offered with approval → second upload succeeds', async () => {
    const w = await world({ healthyPrevious: true });
    const first = await failWith(w, 'upload-error');
    const { deps, ui } = failureDeps(w, [{ match: /دوباره امتحان کنم/, answer: 'retry' }]);
    const out = await handleDeployFailure(first, deps);
    expect(out.failures.map((f) => f.kind)).toEqual(['upload']);
    expect(out.status).toBe('recovered');
    expect(w.deploys()).toBe(2);
    expect(ui.remaining).toBe(0);
    expect(out.incident.kind).toBe('deploy-failure');
    expect(readFileSync(out.reportFiles!.markdown, 'utf8')).toContain(out.incident.id);
  });

  it('build-fail → build analysis → package.json fix → redeploy succeeds', async () => {
    const w = await world({ demo: 'node-build-fail', healthyPrevious: true });
    const first = await failWith(w, 'build');
    const { deps } = failureDeps(w, [{ match: /اعمال/, answer: 'apply' }]);
    const out = await handleDeployFailure(first, deps);
    expect(out.failures.map((f) => f.kind)).toEqual(['build']);
    expect(out.status).toBe('recovered');
    expect(JSON.parse(readFileSync(join(w.dir, 'package.json'), 'utf8')).scripts.build).toBe('tsc');
    expect(out.triedFa).toHaveLength(1);
    // the failed deployment points at the incident
    expect(w.liara.ledger.list('shop').some((r) => r.message?.includes(out.incident.id))).toBe(true);
  });

  it('release-timeout → "unknown", never an automatic redeploy; waiting shows the release came up', async () => {
    const w = await world({ healthyPrevious: true });
    const releasesBefore = w.mock.apps.get('shop')!.releases.length;
    const first = await failWith(w, 'release-timeout');
    expect(w.liara.ledger.latest('shop')?.result).toBe('timeout');

    const leave = await handleDeployFailure(first, failureDeps(w, [{ match: /چه کار کنم/, answer: 'leave' }]).deps);
    expect(leave.failures.map((f) => f.kind)).toEqual(['timeout']);
    expect(leave.status).toBe('unknown');
    expect(leave.incident.status).not.toBe('gave-up');

    const waited = await handleDeployFailure(first, failureDeps(w, [{ match: /چه کار کنم/, answer: 'wait' }]).deps);
    expect(waited.status).toBe('recovered');
    expect(w.deploys()).toBe(1);
    expect(w.mock.apps.get('shop')!.releases.length).toBe(releasesBefore + 1);
    expect(w.approver.seen.filter((p) => p.toolName === 'deploy_app')).toHaveLength(1);
  });

  it('bad-release on a redeploy → the first offer is rollback (R2), then a diagnosis', async () => {
    const w = await world({ healthyPrevious: true });
    const first = await failWith(w, 'bad-release');
    expect(first.failedStep).toBe('verify');
    const { deps, ui } = failureDeps(w, [{ match: /سایت شما الان پایین است/, answer: 'rollback' }]);
    const out = await handleDeployFailure(first, deps);
    expect(ui.prompts[0]?.message).toMatch(/نسخهٔ سالم را برگردانم/);
    expect(out.failures.map((f) => [f.kind, f.isFirstDeploy])).toEqual([['runtime', false]]);
    expect(out.status).toBe('rolled-back');
    expect(w.approver.seen.map((p) => p.toolName)).toContain('rollback_app');
    expect(w.approver.seen.find((p) => p.toolName === 'rollback_app')?.risk).toBe(Risk.R2);
    await w.mock.settle();
    expect(w.mock.apps.get('shop')?.scenario).toBeUndefined();
  });

  it('first-deploy-crash → straight into the SRE cycle (no rollback offer) → resolved', async () => {
    const w = await world();
    const first = await failWith(w, 'missing-env');
    const { deps, ui } = failureDeps(w, [
      { match: /کدام راهکار/, answer: 'root' },
      { match: /نام متغیر/, answer: 'DATABASE_URL' },
      { match: /DATABASE_URL/, answer: SECRET_DB },
    ]);
    const out = await handleDeployFailure(first, deps);
    expect(out.failures.map((f) => [f.kind, f.isFirstDeploy])).toEqual([['runtime', true]]);
    expect(ui.prompts.some((p) => /برگردانم/.test(p.message))).toBe(false);
    expect(out.status).toBe('recovered');
    expect(w.mock.apps.get('shop')?.scenario).toBeUndefined();
    expect(readFileSync(out.reportFiles!.markdown, 'utf8')).not.toContain('db-pass-123');
  });
});
