import { describe, expect, it } from 'vitest';
import {
  collectCodeContext,
  formatContext,
  mapContainerPath,
  resolveLocalImports,
  searchTerms,
} from '../../../src/coder/context.js';
import { parseFrames } from '../../../src/sre/log-cluster.js';
import { project } from '../../helpers/projects.js';

const ROOT = project('coder-express');

const STACK = [
  "TypeError: Cannot read properties of undefined (reading 'items')",
  '    at /usr/src/app/src/routes/orders.js:82:34',
  '    at Layer.handle [as handle_request] (/usr/src/app/node_modules/express/lib/router/layer.js:95:5)',
  '    at /usr/src/app/src/server.js:6:5',
].join('\n');

describe('mapContainerPath', () => {
  const local = ['src/routes/orders.js', 'src/server.js', 'src/lib/total.js', 'lib/total.js', 'package.json'];

  it.each([
    ['/usr/src/app/src/routes/orders.js', 'src/routes/orders.js'],
    ['/app/src/server.js', 'src/server.js'],
    ['file:///app/src/lib/total.js', 'src/lib/total.js'],
    ['/workspace/lib/total.js', 'lib/total.js'],
    ['/app/elsewhere/orders.js', 'src/routes/orders.js'],
    ['/app/x/total.js', undefined],
    ['/app/missing.js', undefined],
  ])('%s → %s', (p, expected) => {
    expect(mapContainerPath(p, local)).toBe(expected);
  });
});

describe('collectCodeContext', () => {
  it('finds the right file and line from a sample stack trace', () => {
    const ctx = collectCodeContext(ROOT, { frames: parseFrames(STACK) });
    const [first] = ctx.snippets;
    expect(first).toMatchObject({ path: 'src/routes/orders.js', focusLine: 82, startLine: 22, endLine: 142, reason: 'frame' });
    expect(first?.content.split('\n')[82 - 22]).toBe('  const total = sumItems(order.items);');
    expect(ctx.snippets.map((s) => [s.path, s.reason])).toEqual([
      ['src/routes/orders.js', 'frame'],
      ['src/server.js', 'frame'],
      ['package.json', 'manifest'],
      ['src/lib/total.js', 'import'],
      ['src/lib/config.js', 'import'],
    ]);
    expect(ctx.unresolved).toEqual([]);
    expect(ctx.truncated).toBe(false);
  });

  it('redacts secrets in collected code', () => {
    const ctx = collectCodeContext(ROOT, { frames: parseFrames(STACK) });
    const text = formatContext(ctx);
    expect(text).not.toContain('fixture-pw-123');
    expect(text).toContain('postgres://shop:***@db:5432/shop');
  });

  it('caps the total size', () => {
    const ctx = collectCodeContext(ROOT, { frames: parseFrames(STACK) }, { maxChars: 500 });
    expect(ctx.totalChars).toBeLessThanOrEqual(500);
    expect(ctx.truncated).toBe(true);
    expect(formatContext(ctx)).toContain('[truncated]');
  });

  it('records unresolved frames', () => {
    const ctx = collectCodeContext(ROOT, { frames: parseFrames('Error: x\n    at f (/app/src/nope/gone.js:3:1)') });
    expect(ctx.unresolved).toEqual(['/app/src/nope/gone.js']);
  });

  it('without a stack, searches the error message in code', () => {
    const ctx = collectCodeContext(ROOT, { message: 'Error: Order not found' });
    expect(ctx.snippets[0]).toMatchObject({ path: 'src/routes/orders.js', focusLine: 161, reason: 'search' });
  });

  it('without a stack, searches the route (mounted prefix stripped)', () => {
    const ctx = collectCodeContext(ROOT, { route: '/api/orders/:id/total' });
    expect(ctx.snippets.filter((s) => s.reason === 'search').map((s) => [s.path, s.focusLine])).toEqual([
      ['src/routes/orders.js', 80],
    ]);
  });

  it('formatContext numbers lines and marks the focus line', () => {
    const out = formatContext(collectCodeContext(ROOT, { frames: parseFrames(STACK) }, { window: 1 }));
    expect(out).toContain('--- src/routes/orders.js:81-83 (frame)');
    expect(out).toContain('>   82 |   const total = sumItems(order.items);');
  });
});

describe('helpers', () => {
  it('resolveLocalImports: JS relative require/import', () => {
    const files = ['src/a.js', 'src/lib/b.ts', 'src/c/index.js'];
    const text = "import x from './lib/b.js';\nconst c = require('./c');\nconst e = require('express');";
    expect(resolveLocalImports('src/a.js', text, files).sort()).toEqual(['src/c/index.js', 'src/lib/b.ts']);
  });

  it('resolveLocalImports: Python relative and absolute', () => {
    const files = ['shop/views.py', 'shop/models.py', 'shop/utils/__init__.py', 'core/settings.py'];
    const text = 'from .models import Order\nfrom .utils import fmt\nfrom core.settings import X\nimport os\n';
    expect(resolveLocalImports('shop/views.py', text, files).sort()).toEqual([
      'core/settings.py',
      'shop/models.py',
      'shop/utils/__init__.py',
    ]);
  });

  it('searchTerms', () => {
    expect(searchTerms({ route: '/api/orders/:id?x=1', message: "KeyError: 'STRIPE_KEY'" })).toEqual([
      '/api/orders/:id',
      '/orders/:id',
      '/:id',
      "'STRIPE_KEY'",
      'STRIPE_KEY',
    ]);
  });
});
