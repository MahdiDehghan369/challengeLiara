import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { runRedeploy } from '../../src/deploy/index.js';
import { createLiaraClient, type LiaraClient } from '../../src/liara/index.js';
import { ScriptedApprover } from '../../src/safety/approval.js';
import { analyzeBuildFailure, buildFixChanges, runBuildDoctor } from '../../src/sre/index.js';
import { ScriptedUi } from '../../src/ui/cli/scripted-ui.js';

const DEMO = join(import.meta.dirname, '..', '..', 'demo-apps', 'node-build-fail');
const root = mkdtempSync(join(tmpdir(), 'siavash-build-doctor-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let open: LiaraClient[] = [];
afterEach(async () => {
  await Promise.all(open.map((c) => c.mock!.servers.close()));
  open = [];
});
const noKeepAlive: typeof fetch = (input, init) => fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), connection: 'close' } });
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const BUILD_FAIL = ['Building...', 'Step 1/3 : RUN npm run build', 'Build failed: npm run build exited with code 1'];

function project(): string {
  const dir = join(mkdtempSync(join(root, 'p-')), 'node-build-fail');
  cpSync(DEMO, dir, { recursive: true, filter: (src) => !src.split(sep).includes('node_modules') });
  return dir;
}

function scripts(dir: string): Record<string, string> {
  return (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
}

describe('build doctor (acceptance: missing build script → fix → successful deploy)', { timeout: 60_000 }, () => {
  it('a failed build is diagnosed from the project, fixed in package.json and redeployed', async () => {
    const dir = project();
    const dataDir = join(mkdtempSync(join(root, 'd-')), 'data');
    const liara = createLiaraClient({ liara: { token: undefined, teamId: undefined, mode: 'mock' }, dataDir }, { mockOptions: { asyncDelayMs: 1 } });
    open.push(liara);
    liara.mock!.state.createApp({ name: 'build-app', planID: 'small-g2', platform: 'node' });
    const approver = new ScriptedApprover(['approved']);
    const redeploy = async () => {
      const r = await runRedeploy(dir, {
        config: { liara: { token: undefined, teamId: undefined, mode: 'mock' }, deployMode: 'cli' },
        liara,
        ui: new ScriptedUi([]),
        ops: { approver },
        app: 'build-app',
        preApproved: true,
        urlFor: (n) => liara.mock!.servers.urlFor(n),
        probe: { count: 2, timeoutMs: 5000, fetchImpl: noKeepAlive },
        wait: { timeoutMs: 2000, intervalMs: 2, sleep: realSleep },
        observeMs: 0,
      });
      return { status: r.status, ...(r.messageFa ? { messageFa: r.messageFa } : {}) };
    };

    // the broken build first fails
    liara.mock!.state.nextDeployFails = true;
    expect((await redeploy()).status).not.toBe('done');

    const ui = new ScriptedUi([{ match: /اعمال/, answer: 'apply' }]);
    const r = await runBuildDoctor({ lines: BUILD_FAIL, projectPath: dir, app: 'build-app' }, { ui, redeploy });

    expect(r.diagnosis.cause).toBe('missing-build-script');
    expect(r.diagnosis.source).toBe('project');
    expect(r.diagnosis.fix).toMatchObject({ type: 'package-script', name: 'build', command: 'tsc' });
    expect(r.diff).toContain('+    "build": "tsc"');
    expect(r.applied).toBe(true);
    expect(scripts(dir).build).toBe('tsc');
    expect(scripts(dir).start).toBe('node dist/index.js');
    expect(r.redeploy?.status).toBe('done');
    expect(ui.remaining).toBe(0);
  });

  it('skip leaves the project untouched and does not redeploy', async () => {
    const dir = project();
    const before = readFileSync(join(dir, 'package.json'), 'utf8');
    let redeploys = 0;
    const r = await runBuildDoctor(
      { lines: BUILD_FAIL, projectPath: dir, app: 'build-app' },
      { ui: new ScriptedUi([{ match: /اعمال/, answer: 'skip' }]), redeploy: async () => (redeploys++, { status: 'done' }) },
    );
    expect(r.applied).toBe(false);
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(before);
    expect(redeploys).toBe(0);
  });

  it('build log patterns win over project rules', async () => {
    const dir = project();
    const missing = await analyzeBuildFailure(['npm ERR! Missing script: "build"'], { projectPath: dir });
    expect([missing.cause, missing.source]).toEqual(['missing-build-script', 'rules']);

    const peer = await analyzeBuildFailure(['npm ERR! code ERESOLVE', 'npm ERR! Could not resolve dependency:'], { projectPath: dir });
    expect(peer.cause).toBe('peer-deps');
    expect(buildFixChanges(dir, peer.fix)).toEqual([{ file: '.npmrc', before: '', after: 'legacy-peer-deps=true\n' }]);
    writeFileSync(join(dir, '.npmrc'), 'legacy-peer-deps=true\n');
    expect(buildFixChanges(dir, peer.fix)).toEqual([]);

    expect((await analyzeBuildFailure(["src/index.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'."])).fix.type).toBe('code_patch');
    expect((await analyzeBuildFailure(['FATAL ERROR: Reached heap limit - JavaScript heap out of memory'])).cause).toBe('build-oom');
    const node = await analyzeBuildFailure(['error @scope/x@1.0.0: The engine "node" is incompatible with this module.'], { projectPath: dir });
    expect(node.cause).toBe('node-version');
    const pkg = buildFixChanges(dir, node.fix)[0];
    expect(JSON.parse(pkg!.after).engines).toEqual({ node: '>=20' });
    expect(existsSync(join(dir, 'dist'))).toBe(false);
  });

  it('with nothing to go on the cause is unknown and no change is offered', async () => {
    const d = await analyzeBuildFailure(['something odd happened']);
    expect([d.cause, d.source, d.fix.type]).toEqual(['unknown', 'none', 'manual']);
  });
});
