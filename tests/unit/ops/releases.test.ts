import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { extract as tarExtract } from 'tar';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ReleaseSignal } from '../../../src/liara/api/deploy.js';
import type { DeployEvent } from '../../../src/liara/cli.js';
import { DeploymentLedger } from '../../../src/liara/ledger.js';
import { listDeployments, resolveRollback, rollbackApp, type RollbackDeployApi } from '../../../src/ops/releases.js';
import { ScriptedApprover } from '../../../src/safety/approval.js';
import { Risk } from '../../../src/safety/risk.js';
import { ApprovalDeniedError, ValidationError } from '../../../src/shared/errors.js';

let repo: string;
let commitV1: string;
let commitV2: string;

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'siavash-repo-'));
  const git = simpleGit(repo);
  await git.init();
  await git.addConfig('user.name', 'test');
  await git.addConfig('user.email', 'test@example.com');
  await git.addConfig('commit.gpgsign', 'false');
  // Windows git defaults to CRLF checkouts; keep file bytes identical across platforms
  await git.addConfig('core.autocrlf', 'false');
  writeFileSync(join(repo, 'index.js'), 'console.log("v1")\n');
  writeFileSync(join(repo, 'package.json'), '{"scripts":{"start":"node index.js"}}\n');
  await git.add('.');
  await git.commit('v1');
  commitV1 = (await git.revparse(['HEAD'])).trim();
  writeFileSync(join(repo, 'index.js'), 'console.log("v2 broken")\n');
  await git.add('.');
  await git.commit('v2');
  commitV2 = (await git.revparse(['HEAD'])).trim();
}, 60_000);

function fakeDeploy(opts: { failCreateWithSource?: string; failUpload?: boolean } = {}) {
  const calls: string[] = [];
  const uploadedIndex: string[] = [];
  const api: RollbackDeployApi = {
    async uploadSource(_app, archivePath) {
      calls.push('upload');
      if (opts.failUpload) throw new Error('upload failed');
      const out = mkdtempSync(join(tmpdir(), 'siavash-x-'));
      await tarExtract({ file: archivePath, cwd: out });
      uploadedIndex.push(readFileSync(join(out, 'index.js'), 'utf8'));
      return 'src-new';
    },
    async createRelease(_app, input) {
      calls.push(`release:${input.sourceID}`);
      if (opts.failCreateWithSource && input.sourceID === opts.failCreateWithSource) throw new Error('source expired');
      return `rel-${calls.length}`;
    },
    async waitForRelease() {
      calls.push('wait');
      return { result: 'success', evidence: ['probe ok'], elapsedMs: 1 };
    },
  };
  return { api, calls, uploadedIndex };
}

const okSignal: ReleaseSignal = { name: 'probe', check: async () => ({ verdict: 'success' }) };

function seedLedger() {
  const ledger = new DeploymentLedger({ dataDir: mkdtempSync(join(tmpdir(), 'siavash-led-')) });
  let t = Date.parse('2026-10-20T10:00:00Z');
  const at = () => new Date((t += 600_000)).toISOString();
  const good = ledger.record({ app: 'shop', mode: 'api', sourceID: 'src-good', releaseID: 'r1', gitCommit: commitV1, port: 3000, platform: 'node', result: 'success', startedAt: at() });
  const bad = ledger.record({ app: 'shop', mode: 'api', sourceID: 'src-bad', releaseID: 'r2', gitCommit: commitV2, port: 3000, platform: 'node', result: 'success', startedAt: at() });
  return { ledger, good, bad };
}

describe('listDeployments', () => {
  it('newest first with Persian relative time', () => {
    const { ledger, good, bad } = seedLedger();
    const list = listDeployments(ledger, 'shop', Date.parse('2026-10-20T11:00:00Z'));
    expect(list.map((d) => d.id)).toEqual([bad.id, good.id]);
    expect(list[0]?.whenFa).toBe('۴۰ دقیقه پیش');
  });
});

describe('rollbackApp', () => {
  it('method 1: new release from the previous sourceID; ledger: rollbackOf + rolled-back', async () => {
    const { ledger, good, bad } = seedLedger();
    const d = fakeDeploy();
    const approver = new ScriptedApprover(['approved']);
    const r = await rollbackApp({ ledger, deploy: d.api, repoDir: repo, releaseSignals: [okSignal] }, 'shop', { approver });
    expect(r.status).toBe('executed');
    if (r.status !== 'executed') return;
    expect(r.result.method).toBe('source');
    expect(d.calls).toEqual(['release:src-good', 'wait']);
    expect(r.result.record).toMatchObject({ rollbackOf: good.id, sourceID: 'src-good', result: 'success' });
    expect(ledger.list('shop').find((x) => x.id === bad.id)?.result).toBe('rolled-back');
    // approval card: R2, both commits visible
    const card = approver.seen[0];
    expect(card?.risk).toBe(Risk.R2);
    expect(card?.impactFa).toContain(commitV1.slice(0, 7));
    expect(card?.impactFa).toContain(commitV2.slice(0, 7));
  });

  it('method 2: falls back to a git worktree of the old commit (archive contains v1)', async () => {
    const { ledger } = seedLedger();
    const d = fakeDeploy({ failCreateWithSource: 'src-good' });
    const r = await rollbackApp({ ledger, deploy: d.api, repoDir: repo, releaseSignals: [okSignal] }, 'shop', {
      approver: new ScriptedApprover(['approved']),
    });
    if (r.status !== 'executed') throw new Error('not executed');
    expect(r.result.method).toBe('git-api');
    expect(r.result.attempts).toEqual([{ method: 'source', error: 'source expired' }, { method: 'git-api' }]);
    expect(d.uploadedIndex).toEqual(['console.log("v1")\n']);
    expect(r.result.record.sourceID).toBe('src-new');
    // worktree cleaned up
    const wt = await simpleGit(repo).raw(['worktree', 'list']);
    expect(wt.trim().split('\n')).toHaveLength(1);
  });

  it('method 3: CLI deploy from the worktree when API upload fails', async () => {
    const { ledger } = seedLedger();
    const d = fakeDeploy({ failUpload: true });
    const cwds: string[] = [];
    const cli = {
      async *deploy(o: { cwd: string }): AsyncIterable<DeployEvent> {
        cwds.push(readFileSync(join(o.cwd, 'index.js'), 'utf8'));
        yield { type: 'done', version: 'v7', exitCode: 0 };
      },
    };
    const r = await rollbackApp({ ledger, deploy: d.api, cli, repoDir: repo, sourceReuse: 'unsupported' }, 'shop', {
      approver: new ScriptedApprover(['approved']),
    });
    if (r.status !== 'executed') throw new Error('not executed');
    expect(r.result.method).toBe('git-cli');
    expect(cwds).toEqual(['console.log("v1")\n']);
    expect(r.result.record).toMatchObject({ mode: 'cli', version: 'v7', result: 'success' });
  });

  it('records health from verify()', async () => {
    const { ledger } = seedLedger();
    const r = await rollbackApp(
      { ledger, deploy: fakeDeploy().api, releaseSignals: [okSignal], verify: async () => ({ score: 92, verdict: 'healthy' }) },
      'shop',
      { approver: new ScriptedApprover(['approved']) },
    );
    if (r.status !== 'executed') throw new Error('not executed');
    expect(r.result.record.healthAfter).toEqual({ score: 92, verdict: 'healthy' });
  });

  it('denied → no deploy calls, ledger unchanged', async () => {
    const { ledger } = seedLedger();
    const d = fakeDeploy();
    await expect(
      rollbackApp({ ledger, deploy: d.api }, 'shop', { approver: new ScriptedApprover(['denied']) }),
    ).rejects.toBeInstanceOf(ApprovalDeniedError);
    expect(d.calls).toEqual([]);
    expect(ledger.list('shop')).toHaveLength(2);
  });

  it('no healthy target or no method → ValidationError', () => {
    const ledger = new DeploymentLedger({ dataDir: mkdtempSync(join(tmpdir(), 'siavash-led-')) });
    expect(() => resolveRollback({ ledger, deploy: fakeDeploy().api }, 'shop')).toThrow(ValidationError);
    ledger.record({ app: 'shop', mode: 'cli', result: 'success' });
    ledger.record({ app: 'shop', mode: 'cli', result: 'failed' });
    expect(() => resolveRollback({ ledger, deploy: fakeDeploy().api }, 'shop')).toThrow(ValidationError);
  });
});
