import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectPort } from '../../../src/analyzer/detect-port.js';
import { detectScripts } from '../../../src/analyzer/detect-scripts.js';
import { project } from '../../helpers/projects.js';

function tmpProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'siavash-an-'));
  for (const [rel, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), c);
  }
  return root;
}
const codes = (w: Array<{ code: string }>) => w.map((x) => x.code);

describe('detectPort', () => {
  it('express: PORT env with default, bound to 0.0.0.0 → no warnings', () => {
    const r = detectPort(project('express-api'), 'node');
    expect(r).toMatchObject({ port: 3000, source: 'env-default', readsPortEnv: true, bindHost: '0.0.0.0' });
    expect(r.warnings).toEqual([]);
    expect(r.evidence[0]).toMatch(/^index\.js:\d+$/);
  });

  it('docker: EXPOSE wins', () => {
    const r = detectPort(project('docker-app'), 'docker');
    expect(r.port).toBe(8080);
    expect(r.source).toBe('expose');
  });

  it('hardcoded listen port without PORT env → PORT_HARDCODED with a Persian fix', () => {
    const r = detectPort(project('nest-api'), 'node');
    expect(r.port).toBe(3000);
    expect(r.source).toBe('listen');
    const w = r.warnings.find((x) => x.code === 'PORT_HARDCODED');
    expect(w?.messageFa).toContain('3000');
    expect(w?.fixFa).toContain('process.env.PORT');
  });

  it('flask: port=5000 literal; host 0.0.0.0', () => {
    const r = detectPort(project('flask-app'), 'flask');
    expect(r.port).toBe(5000);
    expect(r.bindHost).toBe('0.0.0.0');
    expect(codes(r.warnings)).toContain('PORT_HARDCODED');
  });

  it('go reading PORT with no literal → platform default + info', () => {
    const r = detectPort(project('go-app'), 'go');
    expect(r).toMatchObject({ port: 8080, source: 'platform-default', readsPortEnv: true });
    expect(r.warnings.map((w) => [w.code, w.severity])).toEqual([['PORT_DEFAULT_ASSUMED', 'info']]);
  });

  it('binding to localhost is a blocker', () => {
    const root = tmpProject({ 'index.js': "app.listen(process.env.PORT || 3000, 'localhost');\n" });
    const r = detectPort(root, 'node');
    const w = r.warnings.find((x) => x.code === 'BIND_LOCALHOST');
    expect(w?.severity).toBe('blocker');
    expect(w?.fixFa).toContain('0.0.0.0');
  });

  it('flask app.run() without host binds to 127.0.0.1 → blocker', () => {
    const root = tmpProject({ 'requirements.txt': 'flask\n', 'app.py': 'app.run()\n' });
    expect(codes(detectPort(root, 'flask').warnings)).toContain('BIND_LOCALHOST');
  });
});

describe('detectScripts', () => {
  it('express: npm start, no warnings', () => {
    expect(detectScripts(project('express-api'), 'node')).toEqual({
      install: 'npm ci',
      build: undefined,
      start: 'npm start',
      warnings: [],
    });
  });

  it('next: build + start', () => {
    const r = detectScripts(project('next-app'), 'next');
    expect(r.build).toBe('npm run build');
    expect(r.start).toBe('npm start');
    expect(r.warnings).toEqual([]);
  });

  it('missing start (and no main) → blocker', () => {
    const root = tmpProject({ 'package.json': JSON.stringify({ dependencies: { express: '5' } }) });
    const w = detectScripts(root, 'node').warnings[0];
    expect(w).toMatchObject({ code: 'NO_START_SCRIPT', severity: 'blocker' });
  });

  it('nodemon in start → warning', () => {
    const root = tmpProject({
      'package.json': JSON.stringify({ scripts: { start: 'nodemon index.js' }, devDependencies: { nodemon: '3' } }),
    });
    expect(codes(detectScripts(root, 'node').warnings)).toEqual(['NODEMON_START']);
  });

  it('start needs a package that is only in devDependencies → warning naming it', () => {
    const root = tmpProject({
      'package.json': JSON.stringify({ scripts: { start: 'ts-node src/index.ts' }, devDependencies: { 'ts-node': '10' } }),
    });
    const w = detectScripts(root, 'node').warnings[0];
    expect(w?.code).toBe('RUNTIME_IN_DEV_DEPS');
    expect(w?.fixFa).toContain('ts-node');
  });

  it('python: missing gunicorn/uvicorn → warning; present → start command', () => {
    expect(codes(detectScripts(project('flask-app'), 'flask').warnings)).toEqual(['PYTHON_NO_SERVER']);
    expect(detectScripts(project('django-app'), 'django').start).toBe('gunicorn');
    expect(detectScripts(project('fastapi-app'), 'fastapi').start).toBe('uvicorn');
  });
});
