import { describe, expect, it } from 'vitest';
import { guard, SessionApprovals } from '../../../src/safety/approval.js';
import { Risk, type ActionPlan } from '../../../src/safety/risk.js';
import { ApprovalDeniedError } from '../../../src/shared/errors.js';
import { CANCELLED, CliApprover, renderPlanCard, type Prompter, type SelectOption } from '../../../src/ui/cli/approver.js';

const plan = (risk: Risk, over: Partial<ActionPlan> = {}): ActionPlan => ({
  id: 'p1',
  toolName: 'restart_app',
  titleFa: 'ری‌استارت برنامه',
  reasonFa: 'خطای حافظه',
  target: { app: 'shop' },
  risk,
  impactFa: 'چند ثانیه قطعی',
  rollbackFa: 'نیازی نیست',
  command: 'POST /v1/projects/shop/actions/restart',
  params: { name: 'shop' },
  ...over,
});

/** Scripted input: answers are consumed in order; records what was asked. */
class FakePrompter implements Prompter {
  notes: string[] = [];
  asked: string[] = [];
  constructor(private readonly answers: (string | typeof CANCELLED)[] = []) {}
  private next(): string | typeof CANCELLED {
    if (this.answers.length === 0) throw new Error('unexpected prompt');
    return this.answers.shift() as string | typeof CANCELLED;
  }
  note(body: string): void {
    this.notes.push(body);
  }
  async select<V extends string>(message: string, options: SelectOption<V>[]): Promise<V | typeof CANCELLED> {
    this.asked.push(`select:${options.map((o) => o.value).join('/')}`);
    void message;
    return this.next() as V | typeof CANCELLED;
  }
  async text(message: string, opts?: { validate?: (v: string) => string | undefined }): Promise<string | typeof CANCELLED> {
    this.asked.push('text');
    void message;
    const v = this.next();
    if (v !== CANCELLED && opts?.validate?.(v)) return CANCELLED;
    return v;
  }
}

const approver = (answers: (string | typeof CANCELLED)[], opts: { yes?: boolean; interactive?: boolean } = {}) => {
  const prompter = new FakePrompter(answers);
  return { prompter, a: new CliApprover({ prompter, interactive: opts.interactive ?? true, color: false, ...(opts.yes ? { yes: true } : {}) }) };
};

describe('CliApprover — --yes', () => {
  it('auto-approves R1 without prompting', async () => {
    const { a, prompter } = approver([], { yes: true });
    expect(await a.request(plan(Risk.R1))).toBe('approved');
    expect(prompter.asked).toEqual([]);
  });

  it.each([Risk.R2, Risk.R3])('never approves R%d by itself (non-interactive → denied)', async (risk) => {
    const { a, prompter } = approver([], { yes: true, interactive: false });
    expect(await a.request(plan(risk))).toBe('denied');
    expect(prompter.asked).toEqual([]);
    expect(prompter.notes.join('\n')).toContain('--yes');
  });

  it.each([Risk.R2, Risk.R3])('with a TTY, R%d still asks the human (no auto-approval)', async (risk) => {
    const { a, prompter } = approver(['no'], { yes: true });
    expect(await a.request(plan(risk))).toBe('denied');
    expect(prompter.asked).toHaveLength(1);
  });

  it('through guard: --yes + R3 never executes', async () => {
    const { a } = approver([], { yes: true, interactive: false });
    let ran = false;
    await expect(guard(plan(Risk.R3), a, async () => (ran = true))).rejects.toBeInstanceOf(ApprovalDeniedError);
    expect(ran).toBe(false);
  });
});

describe('CliApprover — choices per risk', () => {
  it('R1: run / no / session', async () => {
    expect(await approver(['run']).a.request(plan(Risk.R1))).toBe('approved');
    expect(await approver(['no']).a.request(plan(Risk.R1))).toBe('denied');
    expect(await approver(['session']).a.request(plan(Risk.R1))).toBe('approved-session');
    expect(await approver([CANCELLED]).a.request(plan(Risk.R1))).toBe('denied');
    const { a, prompter } = approver(['run']);
    await a.request(plan(Risk.R1));
    expect(prompter.asked).toEqual(['select:run/no/session']);
  });

  it('R1 session approval is remembered by the gate', async () => {
    const { a, prompter } = approver(['session']);
    const session = new SessionApprovals();
    await guard(plan(Risk.R1), a, async () => 1, { session });
    await guard(plan(Risk.R1), a, async () => 2, { session });
    expect(prompter.asked).toHaveLength(1);
  });

  it('R2: run / no / edit params (JSON)', async () => {
    expect(await approver(['run']).a.request(plan(Risk.R2))).toBe('approved');
    expect(await approver(['no']).a.request(plan(Risk.R2))).toBe('denied');
    expect(await approver(['edit', '{"name":"shop","planID":"small"}']).a.request(plan(Risk.R2))).toEqual({
      edited: { name: 'shop', planID: 'small' },
    });
    expect(await approver(['edit', 'not json']).a.request(plan(Risk.R2))).toBe('denied');
    expect(await approver(['edit', '[1]']).a.request(plan(Risk.R2))).toBe('denied');
    const { a, prompter } = approver(['no']);
    await a.request(plan(Risk.R2));
    expect(prompter.asked).toEqual(['select:run/no/edit']);
  });

  it('R3: requires typing the exact app name; never session-approved', async () => {
    expect(await approver(['shop']).a.request(plan(Risk.R3))).toBe('approved');
    expect(await approver(['  shop ']).a.request(plan(Risk.R3))).toBe('approved');
    expect(await approver(['Shop']).a.request(plan(Risk.R3))).toBe('denied');
    expect(await approver(['yes']).a.request(plan(Risk.R3))).toBe('denied');
    expect(await approver([CANCELLED]).a.request(plan(Risk.R3))).toBe('denied');
    const { a, prompter } = approver(['shop']);
    await a.request(plan(Risk.R3));
    expect(prompter.asked).toEqual(['text']);
  });

  it('without a TTY and without --yes, everything needing approval is denied', async () => {
    for (const r of [Risk.R1, Risk.R2, Risk.R3]) {
      expect(await approver([], { interactive: false }).a.request(plan(r))).toBe('denied');
    }
  });
});

describe('renderPlanCard', () => {
  it('shows what, why, target, cost, risk, rollback and the exact (redacted) command', () => {
    const card = renderPlanCard(
      plan(Risk.R2, {
        costToman: { monthly: 1250000 },
        escalations: ['SECRET_ENV'],
        command: 'liara env:set --app shop --token abcdefghijklmnop1234 DB_PASSWORD=hunter2pw',
      }),
      { color: false },
    );
    for (const s of ['ری‌استارت برنامه', 'خطای حافظه', 'shop', '۱٬۲۵۰٬۰۰۰ تومان در ماه', 'R2', 'SECRET_ENV', 'نیازی نیست']) {
      expect(card).toContain(s);
    }
    expect(card).not.toContain('hunter2pw');
    // command on its own line, separate from Persian text
    expect(card.split('\n').some((l) => l.trim().startsWith('liara env:set'))).toBe(true);
  });

  it('no cost → "no direct cost"', () => {
    expect(renderPlanCard(plan(Risk.R1), { color: false })).toContain('بدون هزینهٔ مستقیم');
  });
});
