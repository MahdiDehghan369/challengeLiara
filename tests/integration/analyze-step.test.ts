import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { writeProjectState } from '../../src/agent/project-state.js';
import { analyzeStep, freeAppName, runPipeline, suggestAppName, type AnalyzeState } from '../../src/deploy/index.js';
import { createLiaraClient } from '../../src/liara/index.js';
import { MockLlm } from '../../src/llm/index.js';
import { CANCELLED } from '../../src/ui/cli/approver.js';
import { ScriptedUi } from '../../src/ui/cli/scripted-ui.js';
import { project } from '../helpers/projects.js';

const root = mkdtempSync(join(tmpdir(), 'siavash-analyze-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function world(existingApps: string[] = []) {
  const liara = createLiaraClient({ liara: { token: undefined, teamId: undefined, mode: 'mock' }, dataDir: join(root, 'data') }, { mockOptions: { asyncDelayMs: 1 } });
  for (const name of existingApps) liara.mock!.state.createApp({ name, planID: 'small-g2', platform: 'node' });
  return liara;
}

function copyProject(fixture: string, folder: string): string {
  const dir = join(mkdtempSync(join(root, 'p-')), folder);
  cpSync(project(fixture), dir, { recursive: true });
  return dir;
}

const run = (deps: Parameters<typeof analyzeStep>[0]) => runPipeline({ id: 'deploy', steps: [analyzeStep<AnalyzeState>(deps)] }, { state: {} });

describe('app name helpers', () => {
  it('kebab-case from the folder name; free name with a numeric suffix', () => {
    expect(suggestAppName('My Shop')).toBe('my-shop');
    expect(suggestAppName('myShopAPI_v2')).toBe('my-shop-api-v2');
    expect(suggestAppName('123')).toBe('app-123');
    expect(suggestAppName('فروشگاه')).toBe('app-siavash');
    expect(freeAppName('shop', new Set(['shop', 'shop-2']))).toBe('shop-3');
    expect(freeAppName('a'.repeat(32), new Set(['a'.repeat(32)]))).toBe(`${'a'.repeat(30)}-2`);
  });
});

describe('analyze & clarify step (ScriptedUI, mock Liara)', () => {
  it('shows the summary, asks LLM questions, a unique app name and the goal', async () => {
    const dir = copyProject('express-api', 'My Shop');
    const ui = new ScriptedUi([
      { match: /دامنه/, answer: 'shop.example.com' },
      // the suggested name is taken → the validator rejects the first try, then the alternative is accepted
      { match: /نام اپ/, answer: 'my-shop' },
      { match: /نام اپ/, answer: '' },
      { match: /هدف/, answer: 'production' },
    ]);
    const llm = new MockLlm().on(() => true, { content: '{"missed":[],"questions":["دامنهٔ اختصاصی دارید؟"],"summaryFa":"یک API اکسپرس."}' });
    const r = await run({ projectPath: dir, liara: world(['my-shop']), ui, llm });
    expect(r.status).toBe('done');
    expect(r.state.report?.platform.platform).toBe('node');
    expect(r.state.answers).toEqual({ 'دامنهٔ اختصاصی دارید؟': 'shop.example.com' });
    expect(r.state.appName).toBe('my-shop-2');
    expect(r.state.redeploy).toBe(false);
    expect(r.state.goal).toBe('production');
    expect(ui.notes[0]?.body).toContain('node');
    expect(ui.notes[0]?.body).toContain('یک API اکسپرس.');
    expect(ui.notes.some((n) => n.title === 'validation' && n.body.includes('my-shop-2'))).toBe(true);
    expect(ui.remaining).toBe(0);
  });

  it('acceptance: --yes takes the defaults without any prompt', async () => {
    const dir = copyProject('express-api', 'shop');
    const ui = new ScriptedUi([]);
    const llm = new MockLlm().on(() => true, { content: '{"missed":[],"questions":["سؤال؟"],"summaryFa":"x"}' });
    const r = await run({ projectPath: dir, liara: world(['shop']), ui, llm, yes: true });
    expect(r.status).toBe('done');
    expect(r.state).toMatchObject({ appName: 'shop-2', goal: 'test', redeploy: false, answers: {} });
    expect(ui.prompts).toEqual([]);
  });

  it('acceptance: --yes still asks about blockers; cancel stops the pipeline', async () => {
    const dir = join(mkdtempSync(join(root, 'p-')), 'empty');
    mkdirSync(dir);
    writeFileSync(join(dir, 'README.md'), '# nothing\n');
    const ui = new ScriptedUi([{ match: /مشکلات|خراب/, answer: 'cancel' }]);
    const r = await run({ projectPath: dir, liara: world(), ui, yes: true });
    expect(r.status).toBe('failed');
    expect(r.messageFa).toContain('لغو');
    expect(ui.notes.some((n) => n.title.includes('مشکلات'))).toBe(true);

    const goOn = new ScriptedUi([{ match: /خراب/, answer: 'continue' }]);
    const r2 = await run({ projectPath: dir, liara: world(), ui: goOn, yes: true });
    expect(r2.status).toBe('done');
  });

  it('project.json exists → offers redeploy to the same app (default with --yes)', async () => {
    const dir = copyProject('express-api', 'shop');
    writeProjectState(dir, { app: 'shop-prod' });
    const ui = new ScriptedUi([{ match: /shop-prod/, answer: 'same' }, { match: /هدف/, answer: 'test' }]);
    const r = await run({ projectPath: dir, liara: world(['shop-prod']), ui, useLlm: false });
    expect(r.state).toMatchObject({ redeploy: true, appName: 'shop-prod' });

    const yes = await run({ projectPath: dir, liara: world(['shop-prod']), ui: new ScriptedUi([]), yes: true });
    expect(yes.state).toMatchObject({ redeploy: true, appName: 'shop-prod' });
  });

  it('choosing "new app" on a deployed project asks for a fresh name', async () => {
    const dir = copyProject('express-api', 'shop');
    writeProjectState(dir, { app: 'shop' });
    const ui = new ScriptedUi(['new', { match: /نام اپ/, answer: '' }, 'test']);
    const r = await run({ projectPath: dir, liara: world(['shop']), ui, useLlm: false });
    expect(r.state).toMatchObject({ redeploy: false, appName: 'shop-2' });
  });

  it('invalid names are rejected by the validator; cancel at any prompt aborts', async () => {
    const dir = copyProject('express-api', 'shop');
    const ui = new ScriptedUi([{ match: /نام اپ/, answer: 'Bad Name!' }, { match: /نام اپ/, answer: CANCELLED }]);
    const r = await run({ projectPath: dir, liara: world(), ui, useLlm: false });
    expect(r.status).toBe('failed');
    expect(ui.notes.some((n) => n.title === 'validation')).toBe(true);
  });
});
