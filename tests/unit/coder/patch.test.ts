import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { collectCodeContext } from '../../../src/coder/context.js';
import { checkPatchPath, generatePatch, locateSearch, validatePatch, type Patch } from '../../../src/coder/patch.js';
import { MockLlm, type ChatRequest } from '../../../src/llm/index.js';
import { ValidationError } from '../../../src/shared/errors.js';
import { parseFrames } from '../../../src/sre/log-cluster.js';

const DEMO = join(import.meta.dirname, '..', '..', '..', 'demo-apps', 'node-http500');
const root = mkdtempSync(join(tmpdir(), 'siavash-patch-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function project(): string {
  const dir = join(mkdtempSync(join(root, 'p-')), 'node-http500');
  cpSync(DEMO, dir, { recursive: true, filter: (src) => !src.split(sep).includes('node_modules') });
  return dir;
}

const STACK = "TypeError: Cannot read properties of undefined (reading 'length')\n    at summarize (/app/src/orders.js:15:29)\n    at Server.<anonymous> (/app/src/server.js:20:31)";

const GOOD: Patch = {
  summaryFa: 'اگر سفارش آیتم نداشته باشد، خطا رخ نمی‌دهد.',
  rootCauseFa: 'order.items ممکن است undefined باشد.',
  edits: [{ file: 'src/orders.js', search: '  const count = order.items.length;\n  const total = order.items.reduce(', replace: '  const items = order.items ?? [];\n  const count = items.length;\n  const total = items.reduce(' }],
  testsToAdd: [{ file: 'test/orders-missing-items.test.js', content: "require('node:assert');\n" }],
  riskFa: 'کم',
};

const reply = (p: unknown) => ({ content: JSON.stringify(p) });

describe('checkPatchPath / locateSearch', () => {
  it.each([
    ['/etc/passwd', false],
    ['C:\\Windows\\x.js', false],
    ['../outside.js', false],
    ['src/../../outside.js', false],
    ['node_modules/express/index.js', false],
    ['.git/config', false],
    ['.env', false],
    ['config/.env.production', false],
    ['.siavash/project.json', false],
    ['src/orders.js', true],
    ['./src/orders.js', true],
  ])('%s → allowed=%s', (file, ok) => {
    expect(checkPatchPath('/proj', file).ok).toBe(ok);
  });

  it('search is found in CRLF files too', () => {
    expect(locateSearch('a\r\nb\r\nc', 'a\nb')).toEqual({ count: 1, crlf: true });
    expect(locateSearch('a\nb', 'x')).toEqual({ count: 0, crlf: false });
  });
});

describe('validatePatch', () => {
  it('a correct patch on the demo app has no problems', () => {
    expect(validatePatch(project(), GOOD)).toEqual([]);
  });

  it('reports missing search, duplicates, missing files and existing test files', () => {
    const dir = project();
    writeFileSync(join(dir, 'src', 'dup.js'), 'x = 1;\nx = 1;\n');
    const problems = validatePatch(dir, {
      ...GOOD,
      edits: [
        { file: 'src/orders.js', search: 'does not exist', replace: 'y' },
        { file: 'src/dup.js', search: 'x = 1;', replace: 'x = 2;' },
        { file: 'src/missing.js', search: 'a', replace: 'b' },
      ],
      testsToAdd: [{ file: 'test/orders.test.js', content: 'x' }],
    });
    expect(problems).toHaveLength(4);
    expect(problems.join('\n')).toMatch(/occurs 0 times[\s\S]*occurs 2 times[\s\S]*does not exist[\s\S]*already exists/);
  });
});

describe('generatePatch (MockLlm)', () => {
  const ctxFor = (dir: string) => collectCodeContext(dir, { frames: parseFrames(STACK), message: STACK.split('\n')[0]! });

  it('success: role code, error + code inside <data>, validated in one round', async () => {
    const dir = project();
    const llm = new MockLlm().on(() => true, reply(GOOD));
    const p = await generatePatch(llm, { root: dir, app: 'shop', error: STACK, context: ctxFor(dir) });
    expect(p).toMatchObject({ rounds: 1, summaryFa: GOOD.summaryFa });
    const req = llm.calls[0] as ChatRequest;
    expect(req.role).toBe('code');
    const text = req.messages.map((m) => m.content ?? '').join('\n');
    expect(text).toContain('<data source="error">');
    expect(text).toContain('<data source="code">');
    expect(text).toContain('order.items.length');
  });

  it('search not found → one correction round quoting the problem, then accepted', async () => {
    const dir = project();
    const llm = new MockLlm()
      .on(() => true, reply({ ...GOOD, edits: [{ file: 'src/orders.js', search: '  15 | const count = order.items.length;', replace: 'x' }] }), 1)
      .on(() => true, reply(GOOD));
    const p = await generatePatch(llm, { root: dir, error: STACK, context: ctxFor(dir) });
    expect(p.rounds).toBe(2);
    const correction = (llm.calls[1] as ChatRequest).messages.map((m) => m.content ?? '').join('\n');
    expect(correction).toContain('occurs 0 times');
  });

  it('acceptance: edits outside the project root are never accepted', async () => {
    const dir = project();
    const evil = { ...GOOD, edits: [{ file: '../../../etc/hosts', search: 'localhost', replace: 'evil' }] };
    const llm = new MockLlm().on(() => true, reply(evil));
    const e = (await generatePatch(llm, { root: dir, error: STACK, context: ctxFor(dir) }).catch((x: unknown) => x)) as ValidationError;
    expect(e).toBeInstanceOf(ValidationError);
    expect(e.messageFa).toMatch(/[\u0600-\u06FF]/);
    expect(String((e.details.problems as string[])[0])).toContain('outside the project root');
    expect(llm.calls).toHaveLength(2);
  });

  it('.env and node_modules edits are rejected too', async () => {
    const dir = project();
    const llm = new MockLlm().on(() => true, reply({ ...GOOD, edits: [{ file: '.env', search: 'A', replace: 'B' }, { file: 'node_modules/x/index.js', search: 'a', replace: 'b' }] }));
    await expect(generatePatch(llm, { root: dir, error: STACK, context: ctxFor(dir) })).rejects.toBeInstanceOf(ValidationError);
  });
});
