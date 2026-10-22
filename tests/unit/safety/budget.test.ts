import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { describe, expect, it } from 'vitest';
import { LiaraHttp } from '../../../src/liara/http.js';
import { LoopBreaker, SessionBudget, type BudgetWarning } from '../../../src/safety/budget.js';
import { BudgetExceededError } from '../../../src/shared/errors.js';

describe('SessionBudget — Liara requests per minute', () => {
  it('soft → one warning; hard → BudgetExceededError; sliding window', () => {
    let t = 0;
    const warnings: BudgetWarning[] = [];
    const b = new SessionBudget({ liaraPerMinuteSoft: 3, liaraPerMinuteHard: 5 }, { now: () => t, onWarn: (w) => warnings.push(w) });
    for (let i = 0; i < 5; i++) b.recordLiaraRequest();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ counter: 'liaraPerMinute', value: 4, limit: 3 });
    expect(warnings[0]?.messageFa).toContain('حد نرم');
    expect(() => b.recordLiaraRequest()).toThrow(BudgetExceededError);
    // a minute later the window is empty again
    t += 61_000;
    expect(() => b.recordLiaraRequest()).not.toThrow();
    expect(b.snapshot().liaraLastMinute).toBe(1);
  });

  it('wired to LiaraHttp.onRequest: the hard limit stops the request before it is sent', async () => {
    const server = setupServer(http.get('https://api.liara.test/v1/projects', () => HttpResponse.json({ projects: [] })));
    server.listen({ onUnhandledRequest: 'error' });
    let sent = 0;
    server.events.on('request:start', () => sent++);
    try {
      const b = new SessionBudget({ liaraPerMinuteSoft: 1, liaraPerMinuteHard: 2 });
      const h = new LiaraHttp({ token: 't', baseUrl: 'https://api.liara.test', onRequest: () => b.recordLiaraRequest() });
      await h.get('/v1/projects');
      await h.get('/v1/projects');
      const e = await h.get('/v1/projects').catch((x: unknown) => x);
      expect(e).toBeInstanceOf(BudgetExceededError);
      expect(sent).toBe(2);
    } finally {
      server.close();
    }
  });
});

describe('SessionBudget — LLM', () => {
  it('counts requests and tokens; hard token limit stops', () => {
    const warnings: BudgetWarning[] = [];
    const b = new SessionBudget({ llmTokensSoft: 1000, llmTokensHard: 2000, llmRequestsSoft: 10, llmRequestsHard: 20 }, { onWarn: (w) => warnings.push(w) });
    b.recordLlm({ promptTokens: 600, completionTokens: 200 });
    b.recordLlm({ totalTokens: 300 });
    expect(b.snapshot()).toMatchObject({ llmRequests: 2, llmTokens: 1100 });
    expect(warnings.map((w) => w.counter)).toEqual(['llmTokens']);
    const e = (() => {
      try {
        b.recordLlm({ totalTokens: 1000 });
      } catch (x) {
        return x as BudgetExceededError;
      }
    })();
    expect(e).toBeInstanceOf(BudgetExceededError);
    expect(e?.messageFa).toContain('حد سخت');
    expect(e?.details).toMatchObject({ counter: 'llmTokens', value: 2100, limit: 2000 });
  });

  it('request count hard limit', () => {
    const b = new SessionBudget({ llmRequestsSoft: 1, llmRequestsHard: 2 });
    b.recordLlm();
    b.recordLlm();
    expect(() => b.recordLlm()).toThrow(BudgetExceededError);
  });
});

describe('LoopBreaker', () => {
  it('same tool + same params more than 3 times → stop; different params are fine', () => {
    const lb = new LoopBreaker();
    for (let i = 0; i < 3; i++) lb.record({ tool: 'get_logs', params: { app: 'shop', lines: 100 }, progress: true });
    lb.record({ tool: 'get_logs', params: { lines: 200, app: 'shop' }, progress: true });
    expect(() => lb.record({ tool: 'get_logs', params: { lines: 100, app: 'shop' }, progress: true })).toThrow(/repeated 4 times/);
  });

  it('N steps without progress → stop; progress resets the count', () => {
    const lb = new LoopBreaker({ maxStepsWithoutProgress: 3 });
    lb.record({ progress: false });
    lb.record({ progress: false });
    lb.record({ progress: true });
    lb.record({ progress: false });
    lb.record({ progress: false });
    expect(() => lb.record({ progress: false })).toThrow(BudgetExceededError);
  });

  it('acceptance: an endless scripted LLM loop is stopped', async () => {
    // A mock LLM that asks for the same tool forever and never finishes.
    const mockLlm = { calls: 0, async next() { this.calls++; return { tool: 'app_status', params: { app: 'shop' }, usage: { totalTokens: 50 } }; } };
    const budget = new SessionBudget();
    const breaker = new LoopBreaker();
    const runAgent = async () => {
      for (;;) {
        const step = await mockLlm.next();
        budget.recordLlm(step.usage);
        breaker.record({ tool: step.tool, params: step.params, progress: false });
      }
    };
    const e = await runAgent().catch((x: unknown) => x as BudgetExceededError);
    expect(e).toBeInstanceOf(BudgetExceededError);
    expect(e.messageFa).toContain('حلقه');
    expect(mockLlm.calls).toBe(4);
  });
});
