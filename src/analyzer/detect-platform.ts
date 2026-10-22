import { exists, hasDep, listFiles, pythonRequirements, readJson, readPackageJson, readText, type PackageJson } from './project-files.js';
import { liaraPlatformId, type Platform } from './platform-map.js';

export interface PlatformDetection {
  platform: Platform;
  /** Liara platform id, or undefined when not yet confirmed (see platform-map, OQ-20). */
  liaraPlatformId: string | undefined;
  /** Runtime version hint (node / python / php / go), if declared. */
  version: string | undefined;
  confidence: number;
  evidence: string[];
}

const NODE_SERVERS = ['@nestjs/core', 'express', 'fastify', 'koa', '@hapi/hapi', 'hapi', 'restify', '@adonisjs/core', 'hono'];

function nodeVersion(root: string, pkg: PackageJson | undefined, evidence: string[]): string | undefined {
  const engines = pkg?.engines?.node;
  if (engines) {
    evidence.push(`package.json: engines.node = "${engines}"`);
    return engines;
  }
  const nvmrc = readText(root, '.nvmrc')?.trim();
  if (nvmrc) {
    evidence.push(`.nvmrc: ${nvmrc}`);
    return nvmrc.replace(/^v/, '');
  }
  return undefined;
}

function pythonVersion(root: string, evidence: string[]): string | undefined {
  const pv = readText(root, '.python-version')?.trim();
  if (pv) {
    evidence.push(`.python-version: ${pv}`);
    return pv;
  }
  const rt = /python-([\d.]+)/.exec(readText(root, 'runtime.txt') ?? '')?.[1];
  if (rt) {
    evidence.push(`runtime.txt: python-${rt}`);
    return rt;
  }
  return undefined;
}

function result(platform: Platform, confidence: number, evidence: string[], version?: string): PlatformDetection {
  return { platform, liaraPlatformId: liaraPlatformId(platform), version, confidence, evidence };
}

/**
 * Deterministic platform detection (no LLM). Order (03-TASKS T4.1):
 * Dockerfile → next → react-scripts/vite without a server → node servers → python frameworks →
 * laravel → go → plain index.html.
 */
export function detectPlatform(root: string): PlatformDetection {
  const evidence: string[] = [];

  if (exists(root, 'Dockerfile')) {
    evidence.push('Dockerfile');
    return result('docker', 0.95, evidence);
  }

  const pkg = readPackageJson(root);
  if (pkg) {
    if (hasDep(pkg, 'next')) {
      evidence.push('package.json: dependency "next"');
      return result('next', 0.95, evidence, nodeVersion(root, pkg, evidence));
    }
    const server = NODE_SERVERS.find((d) => hasDep(pkg, d) === 'dep');
    const spa = ['react-scripts', 'vite', '@vue/cli-service', '@angular/core'].find((d) => hasDep(pkg, d));
    if (spa && !server) {
      evidence.push(`package.json: "${spa}" without a server framework`);
      return result('react-static', 0.85, evidence, nodeVersion(root, pkg, evidence));
    }
    if (server) {
      evidence.push(`package.json: dependency "${server}"`);
      return result('node', 0.9, evidence, nodeVersion(root, pkg, evidence));
    }
    if (pkg.scripts?.start || pkg.main) {
      evidence.push(pkg.scripts?.start ? `package.json: scripts.start = "${pkg.scripts.start}"` : `package.json: main`);
      return result('node', 0.6, evidence, nodeVersion(root, pkg, evidence));
    }
  }

  const py = pythonRequirements(root);
  const hasManagePy = exists(root, 'manage.py');
  if (py.size > 0 || hasManagePy) {
    const version = pythonVersion(root, evidence);
    if (py.has('django') || hasManagePy) {
      evidence.push(py.has('django') ? `${py.get('django')}: django` : 'manage.py');
      return result('django', 0.9, evidence, version);
    }
    if (py.has('fastapi')) {
      evidence.push(`${py.get('fastapi')}: fastapi`);
      return result('fastapi', 0.9, evidence, version);
    }
    if (py.has('flask')) {
      evidence.push(`${py.get('flask')}: flask`);
      return result('flask', 0.9, evidence, version);
    }
  }

  const composer = readJson<{ require?: Record<string, string> }>(root, 'composer.json');
  if (composer?.require?.['laravel/framework']) {
    evidence.push('composer.json: laravel/framework');
    const php = composer.require.php;
    if (php) evidence.push(`composer.json: php ${php}`);
    return result('laravel', 0.9, evidence, php);
  }

  const gomod = readText(root, 'go.mod');
  if (gomod !== undefined) {
    evidence.push('go.mod');
    const v = /^go\s+([\d.]+)/m.exec(gomod)?.[1];
    return result('go', 0.9, evidence, v);
  }

  if (exists(root, 'index.html')) {
    evidence.push('index.html');
    return result('static', 0.8, evidence);
  }
  const html = listFiles(root, { exts: ['.html'], max: 5 });
  if (html.length > 0) {
    evidence.push(`html files: ${html.join(', ')}`);
    return result('static', 0.5, evidence);
  }

  return result('unknown', 0, evidence);
}
