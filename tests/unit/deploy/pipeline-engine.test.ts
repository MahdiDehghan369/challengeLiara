import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Session } from '../../../src/agent/session.js';
import { runPipeline, type Pipeline, type PipelineEvent, type Step } from '../../../src/deploy/pipeline-engine.js';
import { LiaraApiError } from '../../../src/shared/errors.js';

type S = { log: string[]; app?: string };

/** Synthetic failure switch for step 3 (outside the state: checkpointed state wins on resume). */
let failAt3 = false;

const dataDir = () => mkdtempSync(join(tmpdir(), 'siavash-pipe-'));

function step(id: string, extra: Partial<Step<S>> = {}): Step<S> {
  return {
    id,
    titleFa: `مرحله ${id}`,
    run: async (ctx) => {
      ctx.state.log.push(id);
    },
    ...extra,
  };
}

function fivesteps(): Pipeline<S> {
  return {
    id: 'deploy',
    steps: [
      step('s1'),
      step('s2', {
        run: async (ctx) => {
          ctx.state.log.push('s2');
          ctx.state.app = 'shop';
        },
      }),
      step('s3', {
        run: async (ctx) => {
          ctx.state.log.push('s3');
          if (failAt3) throw new LiaraApiError('boom', { messageFa: 'خطای مصنوعی' });
        },
      }),
      step('s4'),
      step('s5'),
    ],
  };
}

describe('runPipeline', () => {
  it('runs all steps in order and emits status events', async () => {
    const events: PipelineEvent[] = [];
    const r = await runPipeline(fivesteps(), { state: { log: [] }, onEvent: (e) => events.push(e) });
    expect(r.status).toBe('done');
    expect(r.state.log).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(Object.values(r.steps).every((s) => s === 'done')).toBe(true);
    expect(events[0]).toEqual({ type: 'pipeline_start', pipelineId: 'deploy' });
    expect(events.filter((e) => e.type === 'step' && e.stepId === 's1').map((e) => (e as { status: string }).status)).toEqual(['running', 'done']);
    expect(events.at(-1)).toMatchObject({ type: 'pipeline_end', status: 'done' });
  });

  it('acceptance: after a synthetic failure at step 3, resume starts at step 3 (state restored from the session)', async () => {
    const dir = dataDir();
    const session = Session.create(dir);
    failAt3 = true;
    const failed = await runPipeline(fivesteps(), { state: { log: [] }, session });
    failAt3 = false;
    expect(failed).toMatchObject({ status: 'failed', failedStep: 's3', messageFa: 'خطای مصنوعی' });
    expect(failed.steps).toEqual({ s1: 'done', s2: 'done', s3: 'failed', s4: 'pending', s5: 'pending' });

    // a fresh process: reload the session from disk
    const reloaded = Session.load(dir, session.id)!;
    expect(reloaded.checkpoint('deploy')).toMatchObject({ status: 'failed', failedStep: 's3' });
    const events: PipelineEvent[] = [];
    const resumed = await runPipeline(fivesteps(), { state: { log: [] }, session: reloaded, resume: true, onEvent: (e) => events.push(e) });
    expect(resumed.status).toBe('done');
    // state from before the failure is restored from the checkpoint
    expect(resumed.state.app).toBe('shop');
    expect(resumed.state.log).toEqual(['s1', 's2', 's3', 's3', 's4', 's5']);
    expect(events[0]).toMatchObject({ type: 'pipeline_start', resumedFrom: 's3' });
    const ran = events.filter((e) => e.type === 'step' && e.status === 'running').map((e) => (e as { stepId: string }).stepId);
    expect(ran).toEqual(['s3', 's4', 's5']);
  });

  it('skipIf → skipped and never run', async () => {
    const p: Pipeline<S> = { id: 'p', steps: [step('a'), step('b', { skipIf: () => true }), step('c')] };
    const r = await runPipeline(p, { state: { log: [] } });
    expect(r.state.log).toEqual(['a', 'c']);
    expect(r.steps.b).toBe('skipped');
  });

  it('safe cancel between steps: the running step completes, the next does not start; resumable', async () => {
    const ac = new AbortController();
    const session = Session.create(dataDir());
    const p: Pipeline<S> = {
      id: 'p',
      steps: [
        step('a', {
          run: async (ctx) => {
            ac.abort();
            await new Promise((r) => setTimeout(r, 5));
            ctx.state.log.push('a-finished');
          },
        }),
        step('b'),
      ],
    };
    const r = await runPipeline(p, { state: { log: [] }, signal: ac.signal, session });
    expect(r.status).toBe('cancelled');
    expect(r.state.log).toEqual(['a-finished']);
    expect(r.steps).toEqual({ a: 'done', b: 'pending' });
    expect(r.messageFa).toContain('--resume');
    const again = await runPipeline(p, { state: { log: [] }, session, resume: true });
    expect(again.status).toBe('done');
    expect(again.state.log).toEqual(['a-finished', 'b']);
  });

  it("onFail 'ask': retry then succeed; skip continues", async () => {
    let n = 0;
    const flaky = step('f', {
      onFail: 'ask',
      run: async () => {
        if (n++ === 0) throw new Error('first try');
      },
    });
    const r = await runPipeline({ id: 'p', steps: [flaky, step('z')] }, { state: { log: [] }, ask: async () => 'retry' });
    expect(r.status).toBe('done');
    expect(n).toBe(2);

    const broken = step('x', { onFail: 'ask', run: async () => Promise.reject(new Error('nope')) });
    const s = await runPipeline({ id: 'p', steps: [broken, step('z')] }, { state: { log: [] }, ask: async () => 'skip' });
    expect(s.status).toBe('done');
    expect(s.steps).toEqual({ x: 'skipped', z: 'done' });
    expect(s.state.log).toEqual(['z']);

    const aborted = await runPipeline({ id: 'p', steps: [broken, step('z')] }, { state: { log: [] }, ask: async () => 'abort' });
    expect(aborted).toMatchObject({ status: 'failed', failedStep: 'x' });
  });

  it("onFail 'diagnose': diagnosis attached, pipeline stops; a throwing diagnoser does not hide the error", async () => {
    const broken = step('x', { onFail: 'diagnose', run: async () => Promise.reject(new Error('crash')) });
    const r = await runPipeline({ id: 'p', steps: [broken] }, { state: { log: [] }, diagnose: async () => 'متغیر DATABASE_URL تنظیم نشده' });
    expect(r).toMatchObject({ status: 'failed', diagnosisFa: 'متغیر DATABASE_URL تنظیم نشده' });
    expect(r.messageFa).toContain('مرحله x');
    const r2 = await runPipeline({ id: 'p', steps: [broken] }, { state: { log: [] }, diagnose: async () => Promise.reject(new Error('llm down')) });
    expect(r2.status).toBe('failed');
    expect((r2.error as Error).message).toBe('crash');
  });

  it('waiting-approval / waiting-human statuses; a human step pauses and reruns on resume', async () => {
    const session = Session.create(dataDir());
    let charged = false;
    const events: PipelineEvent[] = [];
    const p: Pipeline<S> = {
      id: 'p',
      steps: [
        step('approve', {
          run: async (ctx) => {
            ctx.setStatus('waiting-approval');
            ctx.setStatus('running');
          },
        }),
        step('billing', {
          run: async () => (charged ? undefined : { status: 'waiting-human', messageFa: 'لطفاً حساب را شارژ کنید' }),
        }),
        step('after'),
      ],
    };
    const r = await runPipeline(p, { state: { log: [] }, session, onEvent: (e) => events.push(e) });
    expect(r).toMatchObject({ status: 'waiting-human', failedStep: 'billing', messageFa: 'لطفاً حساب را شارژ کنید' });
    const statuses = events.filter((e) => e.type === 'step').map((e) => `${(e as { stepId: string }).stepId}:${(e as { status: string }).status}`);
    expect(statuses).toEqual(expect.arrayContaining(['approve:waiting-approval', 'billing:waiting-human']));
    expect(r.steps.billing).toBe('pending');
    charged = true;
    const done = await runPipeline(p, { state: { log: [] }, session, resume: true });
    expect(done.status).toBe('done');
    expect(done.state.log).toEqual(['after']);
  });

  it('resume without a checkpoint starts from the beginning; duplicate ids are rejected', async () => {
    const r = await runPipeline(fivesteps(), { state: { log: [] }, session: Session.create(dataDir()), resume: true, persist: false });
    expect(r.state.log).toEqual(['s1', 's2', 's3', 's4', 's5']);
    await expect(runPipeline({ id: 'd', steps: [step('a'), step('a')] }, { state: { log: [] } })).rejects.toThrow(/duplicate/);
  });
});
