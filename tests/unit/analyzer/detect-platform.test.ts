import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectPlatform } from '../../../src/analyzer/detect-platform.js';
import { PLATFORM_MAP } from '../../../src/analyzer/platform-map.js';
import { project } from '../../helpers/projects.js';

const at = (name: string) => detectPlatform(project(name));

describe('detectPlatform', () => {
  it.each([
    ['docker-app', 'docker'],
    ['next-app', 'next'],
    ['vite-react-static', 'react-static'],
    ['express-api', 'node'],
    ['nest-api', 'node'],
    ['django-app', 'django'],
    ['flask-app', 'flask'],
    ['fastapi-app', 'fastapi'],
    ['laravel-app', 'laravel'],
    ['go-app', 'go'],
    ['static-site', 'static'],
    ['empty-dir', 'unknown'],
  ])('%s → %s', (dir, platform) => {
    const d = at(dir);
    expect(d.platform).toBe(platform);
    if (platform !== 'unknown') {
      expect(d.evidence.length).toBeGreaterThan(0);
      expect(d.confidence).toBeGreaterThan(0);
    }
  });

  it('Dockerfile wins over package.json', () => {
    expect(at('docker-app').evidence).toEqual(['Dockerfile']);
  });

  it('reads versions from engines, .nvmrc, .python-version, composer and go.mod', () => {
    expect(at('next-app').version).toBe('>=20');
    expect(at('express-api').version).toBe('22.11.0');
    expect(at('django-app').version).toBe('3.12');
    expect(at('laravel-app').version).toBe('^8.2');
    expect(at('go-app').version).toBe('1.22');
  });

  it('only documented Liara platform ids are filled; others stay undefined (OQ-20)', () => {
    expect(at('docker-app').liaraPlatformId).toBe('docker');
    expect(at('next-app').liaraPlatformId).toBe('next');
    expect(at('django-app').liaraPlatformId).toBeUndefined();
    for (const info of Object.values(PLATFORM_MAP)) {
      if (info.liaraId === undefined) expect(info.source).toBe('unknown');
    }
  });

  it('the bundled demo app is detected as node', () => {
    const d = detectPlatform(join(import.meta.dirname, '..', '..', '..', 'demo-apps', 'node-express-ok'));
    expect(d.platform).toBe('node');
  });

  it.todo('fill the remaining Liara platform ids once recorded (OQ-20)');
});
