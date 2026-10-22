import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { projectStatePath, readProjectState, Session, writeProjectState } from '../../../src/agent/index.js';
import { MockLlm } from '../../../src/llm/index.js';
import { Risk, type ActionPlan } from '../../../src/safety/risk.js';

const root = mkdtempSync(join(tmpdir(), 'session-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const fresh = () => {
  const dir = join(root, `case-${++n}`);
  mkdirSync(dir, { recursive: true });
  return { dataDir: join(dir, 'data'), project: join(dir, 'project') };
};

describe('project state (.siavash/project.json)', () => {
  it('merges and persists; missing or invalid file → undefined', () => {
    const { project } = fresh();
    mkdirSync(project, { recursive: true });
    expect(readProjectState(project)).toBeUndefined();
    writeProjectState(project, { app: 'shop', platform: 'node', port: 3000 });
    writeProjectState(project, { lastDeploymentId: 'dep-1', deployMode: 'cli' });
    expect(readProjectState(project)).toMatchObject({ app: 'shop', platform: 'node', port: 3000, lastDeploymentId: 'dep-1', deployMode: 'cli' });
    writeFileSync(projectStatePath(project), '{not json');
    expect(readProjectState(project)).toBeUndefined();
  });

  it('acceptance: after a restart the project app is recognised by a new session', () => {
    const { dataDir, project } = fresh();
    mkdirSync(project, { recursive: true });
    writeProjectState(project, { app: 'shop' });
    // "restart": nothing in memory, a brand new session for the same folder
    const s = Session.create(dataDir, { projectPath: project });
    expect(s.currentApp).toBe('shop');
  });
});

describe('Session persistence', () => {
  it('save → load/latest restores messages, facts, incidents and R1 session approvals', () => {
    const { dataDir, project } = fresh();
    let t = Date.parse('2026-10-22T10:00:00Z');
    const s = Session.create(dataDir, { projectPath: project, now: () => new Date((t += 1000)) });
    s.setCurrentApp('shop');
    s.addMessage({ role: 'user', content: 'لاگ‌ها رو ببین' });
    s.addMessage({ role: 'assistant', content: null, toolCalls: [{ id: 'c1', name: 'get_logs', arguments: '{"app":"shop"}' }] });
    s.addMessage({ role: 'tool', toolCallId: 'c1', content: '{"total":3}' });
    s.setFact('port', '3000');
    const inc = s.addIncident({ app: 'shop', titleFa: 'خطای ۵۰۰' });
    const plan = { toolName: 'restart_app', target: { app: 'shop' }, risk: Risk.R1 } as ActionPlan;
    s.approvals.remember(plan);
    s.save();

    const loaded = Session.load(dataDir, s.id);
    expect(loaded?.currentApp).toBe('shop');
    expect(loaded?.messages).toHaveLength(3);
    expect(loaded?.facts).toEqual({ port: '3000' });
    expect(loaded?.incidents[0]).toMatchObject({ id: inc.id, status: 'open' });
    expect(loaded?.approvals.has(plan)).toBe(true);
    expect(Session.latest(dataDir, { projectPath: project })?.id).toBe(s.id);
    expect(Session.latest(dataDir, { projectPath: join(root, 'other') })).toBeUndefined();
    expect(Session.load(dataDir, 'nope')).toBeUndefined();
  });

  it('saved file is redacted and owner-only', () => {
    const { dataDir } = fresh();
    const s = Session.create(dataDir);
    s.addMessage({ role: 'user', content: 'DATABASE_URL=postgres://u:hunter2pw@db:5432/x' });
    s.save();
    const file = join(dataDir, 'sessions', `${s.id}.json`);
    expect(readFileSync(file, 'utf8')).not.toContain('hunter2pw');
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});

describe('Session.compact', () => {
  it('summarises old turns with the cheap model, keeps recent ones, never orphans a tool result', async () => {
    const { dataDir } = fresh();
    const s = Session.create(dataDir);
    for (let i = 0; i < 8; i++) {
      s.addMessage({ role: 'user', content: `question ${i} ${'x'.repeat(200)}` });
      s.addMessage({ role: 'assistant', content: null, toolCalls: [{ id: `c${i}`, name: 'list_apps', arguments: '{}' }] });
      s.addMessage({ role: 'tool', toolCallId: `c${i}`, content: 'y'.repeat(200) });
    }
    const llm = new MockLlm().on(() => true, { content: 'خلاصه: کاربر درباره اپ shop پرسید.' });
    expect(await s.compact(llm, { maxChars: 1000, keepLast: 4 })).toBe(true);
    expect(llm.calls[0]?.role).toBe('cheap');
    expect(s.summary).toContain('shop');
    expect(s.messages[0]?.role).not.toBe('tool');
    expect(s.messages.length).toBeLessThanOrEqual(5);
    expect(s.contextMessages()[0]).toMatchObject({ role: 'system' });
    // small context → no compaction
    expect(await Session.create(dataDir).compact(llm)).toBe(false);
  });
});
