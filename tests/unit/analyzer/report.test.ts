import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeProject, LLM_INPUT_BUDGET } from '../../../src/analyzer/report.js';
import { MockLlm } from '../../../src/llm/index.js';
import { project } from '../../helpers/projects.js';

function tmpProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'siavash-report-'));
  for (const [rel, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), c);
  }
  return root;
}

const sentText = (llm: MockLlm): string => (llm.calls[0]?.messages ?? []).map((m) => m.content ?? '').join('\n');

describe('analyzeProject (deterministic)', () => {
  it('acceptance: works without an LLM (express-api → needs-input for JWT_SECRET)', async () => {
    const r = await analyzeProject(project('express-api'), { useLlm: false });
    expect(r.platform.platform).toBe('node');
    expect(r.port.port).toBe(3000);
    expect(r.scripts.start).toBe('npm start');
    // DATABASE_URL is provisioned by the agent (postgres), JWT_SECRET must come from the user.
    expect(r.missingEnv).toEqual(['JWT_SECRET']);
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['EPHEMERAL_FS', 'MISSING_ENV']));
    expect(r.blockers).toEqual([]);
    expect(r.readiness).toBe('needs-input');
    expect(r.questions).toEqual([]);
    expect(r.llm).toEqual({ used: false });
    expect(r.size.files).toBeGreaterThan(0);
    expect(r.size.mb).toBeGreaterThanOrEqual(0);
  });

  it('unknown platform → blocked', async () => {
    const r = await analyzeProject(project('empty-dir'));
    expect(r.readiness).toBe('blocked');
    expect(r.blockers.map((b) => b.code)).toContain('UNKNOWN_PLATFORM');
  });

  it('detector blockers (no start script) → blocked', async () => {
    const root = tmpProject({ 'package.json': JSON.stringify({ name: 'x', dependencies: { express: '^4' } }) });
    const r = await analyzeProject(root);
    expect(r.readiness).toBe('blocked');
    expect(r.blockers.length).toBeGreaterThan(0);
  });

  it('platform without a confirmed Liara id → warning, not blocker (OQ-20)', async () => {
    const r = await analyzeProject(project('django-app'));
    expect(r.warnings.find((w) => w.code === 'PLATFORM_UNVERIFIED')?.severity).toBe('warning');
    expect(r.blockers.map((b) => b.code)).not.toContain('PLATFORM_UNVERIFIED');
  });

  it('useLlm without a client → deterministic only', async () => {
    const r = await analyzeProject(project('express-api'), { useLlm: true });
    expect(r.llm.used).toBe(false);
  });
});

describe('analyzeProject (LLM pass)', () => {
  it('adds info findings, ≤3 questions and a summary; deterministic results win', async () => {
    const llm = new MockLlm().on(() => true, {
      content: JSON.stringify({
        missed: [
          { code: 'EPHEMERAL_FS', detailFa: 'تکراری' },
          { code: 'redis cache', detailFa: 'به نظر Redis لازم است.' },
          { code: 'NO_HEALTHCHECK', detailFa: 'مسیر سلامت وجود ندارد.' },
        ],
        questions: ['س۱؟', 'س۲؟', 'س۳؟', 'س۴؟'],
        summaryFa: 'یک API اکسپرس با PostgreSQL.',
        port: 9999,
        readiness: 'ready',
      }),
    });
    const r = await analyzeProject(project('express-api'), { useLlm: true, llm });
    expect(r.llm.used).toBe(true);
    expect(r.port.port).toBe(3000);
    expect(r.questions).toEqual(['س۱؟', 'س۲؟', 'س۳؟']);
    expect(r.summaryFa).toContain('اکسپرس');
    const added = r.warnings.filter((w) => w.evidence === 'llm');
    expect(added.map((w) => [w.code, w.severity])).toEqual([
      ['LLM_FINDING', 'info'],
      ['NO_HEALTHCHECK', 'info'],
    ]);
    expect(r.warnings.filter((w) => w.code === 'EPHEMERAL_FS')).toHaveLength(1);
    expect(r.readiness).toBe('needs-input');
    expect(llm.calls[0]?.role).toBe('reasoning');
    expect(llm.calls[0]?.json).toBe(true);
    expect(sentText(llm)).toContain('<data source="package.json">');
  });

  it('LLM questions alone make a ready project needs-input; LLM cannot unblock', async () => {
    const llm = new MockLlm().on(() => true, { content: '{"missed":[],"questions":["دامنه؟"],"summaryFa":"x"}' });
    const blocked = await analyzeProject(project('empty-dir'), { useLlm: true, llm });
    expect(blocked.readiness).toBe('blocked');
  });

  it('sends only redacted key files, never .env, within the 12k budget', async () => {
    const root = tmpProject({
      'package.json': JSON.stringify({ name: 'x', main: 'index.js', scripts: { start: 'node index.js' }, dependencies: { express: '^4' } }),
      'index.js': `const db = 'postgres://admin:sup3rS3cretPw@db:5432/app';\n${'// filler\n'.repeat(2000)}app.listen(process.env.PORT || 3000, '0.0.0.0');\n`,
      '.env': 'JWT_SECRET=dotenv-value-must-not-leak\n',
      'Dockerfile': `FROM node:22\n${'RUN echo hi\n'.repeat(600)}`,
    });
    const llm = new MockLlm().on(() => true, { content: '{"missed":[],"questions":[],"summaryFa":"ok"}' });
    await analyzeProject(root, { useLlm: true, llm });
    const text = sentText(llm);
    expect(text).not.toContain('dotenv-value-must-not-leak');
    expect(text).not.toContain('sup3rS3cretPw');
    expect(text).not.toContain('source=".env"');
    const dataChars = [...text.matchAll(/<data[^>]*>\n([\s\S]*?)\n<\/data>/g)].reduce((n, m) => n + (m[1]?.length ?? 0), 0);
    expect(dataChars).toBeGreaterThan(0);
    expect(dataChars).toBeLessThanOrEqual(LLM_INPUT_BUDGET);
  });

  it('LLM failure → deterministic report with a Persian note', async () => {
    const llm = new MockLlm().on(() => true, { content: 'not json' });
    const r = await analyzeProject(project('express-api'), { useLlm: true, llm });
    expect(r.llm.used).toBe(false);
    expect(r.llm.errorFa).toBeTruthy();
    expect(r.readiness).toBe('needs-input');
    expect(r.missingEnv).toEqual(['JWT_SECRET']);
  });
});
