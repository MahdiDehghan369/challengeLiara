import { fa } from '../ui/cli/i18n/fa.js';
import type { Platform } from './platform-map.js';
import { hasDep, pythonRequirements, readPackageJson } from './project-files.js';
import type { AnalyzerWarning } from './types.js';

export interface ScriptsDetection {
  install: string | undefined;
  build: string | undefined;
  start: string | undefined;
  warnings: AnalyzerWarning[];
}

/** CLI binaries commonly used in `start` scripts → the package that provides them. */
const BIN_PACKAGES: Record<string, string> = {
  next: 'next',
  nest: '@nestjs/cli',
  'ts-node': 'ts-node',
  tsx: 'tsx',
  nuxt: 'nuxt',
  'react-scripts': 'react-scripts',
  serve: 'serve',
  pm2: 'pm2',
  prisma: 'prisma',
};

const NODE_LIKE: Platform[] = ['node', 'next', 'react-static', 'docker'];
const NEEDS_BUILD: Platform[] = ['next', 'react-static'];

export function detectScripts(root: string, platform: Platform): ScriptsDetection {
  const warnings: AnalyzerWarning[] = [];
  const pkg = readPackageJson(root);

  if (pkg && NODE_LIKE.includes(platform)) {
    const scripts = pkg.scripts ?? {};
    const start = scripts.start;
    const build = scripts.build;

    if (!start && platform !== 'react-static' && platform !== 'docker') {
      warnings.push({
        code: 'NO_START_SCRIPT',
        severity: pkg.main ? 'warning' : 'blocker',
        messageFa: fa.analyzer.noStartScript,
        fixFa: fa.analyzer.noStartScriptFix,
        evidence: 'package.json: scripts',
      });
    }
    if (start && /\bnodemon\b/.test(start)) {
      warnings.push({
        code: 'NODEMON_START',
        severity: 'warning',
        messageFa: fa.analyzer.nodemonStart,
        fixFa: fa.analyzer.nodemonStartFix,
        evidence: `package.json: scripts.start = "${start}"`,
      });
    }
    if (start) {
      const bin = /^\s*(?:npx\s+)?([a-z@][\w./-]*)/.exec(start)?.[1];
      const providing = bin ? BIN_PACKAGES[bin] : undefined;
      if (providing && hasDep(pkg, providing) === 'dev') {
        warnings.push({
          code: 'RUNTIME_IN_DEV_DEPS',
          severity: 'warning',
          messageFa: fa.analyzer.runtimeInDevDeps(providing),
          fixFa: fa.analyzer.runtimeInDevDepsFix(providing),
          evidence: `package.json: devDependencies.${providing}`,
        });
      }
    }
    if (!build && NEEDS_BUILD.includes(platform)) {
      warnings.push({
        code: 'NO_BUILD_SCRIPT',
        severity: 'blocker',
        messageFa: fa.analyzer.noBuildScript,
        fixFa: fa.analyzer.noBuildScriptFix,
        evidence: 'package.json: scripts',
      });
    }
    return {
      install: 'npm ci',
      build: build ? 'npm run build' : undefined,
      start: start ? 'npm start' : pkg.main ? `node ${pkg.main}` : undefined,
      warnings,
    };
  }

  if (platform === 'django' || platform === 'flask' || platform === 'fastapi') {
    const req = pythonRequirements(root);
    const server = platform === 'fastapi' ? (req.has('uvicorn') ? 'uvicorn' : undefined) : req.has('gunicorn') ? 'gunicorn' : undefined;
    if (!server) {
      warnings.push({
        code: 'PYTHON_NO_SERVER',
        severity: 'warning',
        messageFa: fa.analyzer.pythonNoServer,
        fixFa: fa.analyzer.pythonNoServerFix,
      });
    }
    return { install: 'pip install -r requirements.txt', build: undefined, start: server, warnings };
  }

  if (platform === 'laravel') return { install: 'composer install --no-dev', build: undefined, start: undefined, warnings };
  if (platform === 'go') return { install: undefined, build: 'go build', start: undefined, warnings };
  return { install: undefined, build: undefined, start: undefined, warnings };
}
