import { describe, expect, it } from 'vitest';
import type { PipelineEvent } from '../../../src/deploy/pipeline-engine.js';
import { percentIn, progressLine, renderMode, StepsView } from '../../../src/ui/cli/render/index.js';

const P = 'deploy';
const step = (stepId: string, titleFa: string, status: Extract<PipelineEvent, { type: 'step' }>['status'], noteFa?: string): PipelineEvent => ({ type: 'step', pipelineId: P, stepId, titleFa, status, ...(noteFa ? { noteFa } : {}) });

/** A deploy run: preflight ok, plan waits for approval, deploy uploads then fails. */
const RUN: Array<[number, PipelineEvent]> = [
  [0, { type: 'pipeline_start', pipelineId: P }],
  [0, step('preflight', 'بررسی پیش از شروع', 'running')],
  [1200, step('preflight', 'بررسی پیش از شروع', 'done')],
  [1200, step('plan', 'انتخاب پلن و هزینه', 'running')],
  [1300, step('plan', 'انتخاب پلن و هزینه', 'waiting-approval', 'کارت تأیید را ببینید')],
  [5300, step('plan', 'انتخاب پلن و هزینه', 'running')],
  [5400, step('plan', 'انتخاب پلن و هزینه', 'done')],
  [5400, step('domain', 'دامنه', 'skipped')],
  [5400, step('deploy', 'deploy', 'running', 'آپلود: ۲۵٪')],
  [6400, step('deploy', 'deploy', 'running', 'آپلود: 75%')],
  [9000, step('deploy', 'deploy', 'failed')],
  [9000, { type: 'pipeline_end', pipelineId: P, status: 'failed', failedStep: 'deploy', messageFa: 'deploy شکست خورد.' }],
];

function play(mode: 'tty' | 'lines' | 'json', upto = RUN.length) {
  let t = 0;
  const out: string[] = [];
  const view = new StepsView({ mode, write: (s) => out.push(s), now: () => t, color: false, spinnerMs: 0 });
  for (const [at, e] of RUN.slice(0, upto)) {
    t = at;
    view.handle(e);
  }
  return { out, view };
}

describe('step rendering (T9.3)', () => {
  it('non-TTY: one line per transition, with times, the waiting state and the failure', () => {
    const { out } = play('lines');
    expect(out.join('\n')).toMatchSnapshot();
    expect(out.some((l) => l.includes('⏸') && l.includes('منتظر تأیید شما'))).toBe(true);
  });

  it('TTY frame mid-upload: checklist + upload bar under the current step', () => {
    const { view } = play('tty', 10);
    const frame = view.renderFrame();
    expect(frame).toMatchSnapshot();
    expect(frame).toContain('███████████████░░░░░');
  });

  it('--json: one JSON object per event, redacted', () => {
    const { out } = play('json');
    expect(out).toHaveLength(RUN.length);
    expect(out.map((l) => (JSON.parse(l) as PipelineEvent).type)).toContain('pipeline_end');
    const leak = new StepsView({ mode: 'json', write: (s) => out.push(s) });
    leak.handle(step('x', 'x', 'running', 'url postgres://u:hunter2pass@db:5432/x'));
    expect(out.at(-1)).not.toContain('hunter2pass');
  });

  it('percent parsing and mode choice', () => {
    expect([percentIn('آپلود: ۴۰٪'), percentIn('50 %'), percentIn('no'), percentIn('999%')]).toEqual([40, 50, undefined, undefined]);
    expect(progressLine('x', 10)).toBeUndefined();
    expect([renderMode({ json: true, isTTY: true }), renderMode({ isTTY: true }), renderMode({})]).toEqual(['json', 'tty', 'lines']);
  });
});
