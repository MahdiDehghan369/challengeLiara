import { fa } from '../ui/cli/i18n/fa.js';
import type { Platform } from './platform-map.js';
import { listFiles, readText } from './project-files.js';
import type { AnalyzerWarning } from './types.js';

export interface PortDetection {
  port: number;
  source: 'env-default' | 'listen' | 'expose' | 'cli-flag' | 'platform-default';
  /** True if the code reads the PORT env var anywhere. */
  readsPortEnv: boolean;
  /** Host the app binds to, if found explicitly. */
  bindHost: string | undefined;
  evidence: string[];
  warnings: AnalyzerWarning[];
}

/**
 * Conventional ports used when nothing is found in the code. These are framework defaults, not
 * Liara facts; the result is flagged with a `PORT_DEFAULT_ASSUMED` info finding.
 */
export const PLATFORM_DEFAULT_PORT: Record<Platform, number> = {
  docker: 80,
  next: 3000,
  'react-static': 80,
  node: 3000,
  django: 8000,
  flask: 5000,
  fastapi: 8000,
  laravel: 80,
  go: 8080,
  static: 80,
  unknown: 3000,
};

const SOURCE_EXTS = ['.js', '.mjs', '.cjs', '.ts', '.py', '.go', '.php'];

interface Hit {
  file: string;
  line: number;
  text: string;
}

function scan(root: string): Array<{ file: string; lines: string[] }> {
  return listFiles(root, { exts: SOURCE_EXTS, max: 400 })
    .map((file) => ({ file, lines: (readText(root, file) ?? '').split(/\r?\n/) }))
    .filter((f) => f.lines.length > 0);
}

function find(files: Array<{ file: string; lines: string[] }>, re: RegExp): Array<Hit & { m: RegExpExecArray }> {
  const out: Array<Hit & { m: RegExpExecArray }> = [];
  for (const f of files) {
    f.lines.forEach((text, i) => {
      const m = re.exec(text);
      if (m) out.push({ file: f.file, line: i + 1, text, m });
    });
  }
  return out;
}

const PORT_ENV_RE = /process\.env\.PORT|process\.env\[['"]PORT['"]\]|os\.environ(?:\.get)?\(?\[?['"]PORT['"]|os\.getenv\(['"]PORT['"]|os\.Getenv\("PORT"\)|env\(['"]PORT['"]|getenv\(['"]PORT['"]/;

export function detectPort(root: string, platform: Platform): PortDetection {
  const files = scan(root);
  const evidence: string[] = [];
  const warnings: AnalyzerWarning[] = [];
  const readsPortEnv = find(files, PORT_ENV_RE).length > 0;

  let port: number | undefined;
  let source: PortDetection['source'] = 'platform-default';

  // process.env.PORT || 3000  /  ?? 3000  /  os.environ.get("PORT", 8000)
  const envDefault = find(
    files,
    /(?:process\.env\.PORT|process\.env\[['"]PORT['"]\])\s*(?:\|\||\?\?)\s*['"]?(\d{2,5})|['"]PORT['"]\s*,\s*['"]?(\d{2,5})/,
  )[0];
  if (envDefault) {
    port = Number(envDefault.m[1] ?? envDefault.m[2]);
    source = 'env-default';
    evidence.push(`${envDefault.file}:${envDefault.line}`);
  }

  const listenLiteral = find(files, /\.(?:listen|run)\(\s*(?:port\s*=\s*)?['"]?:?(\d{2,5})\b|port\s*=\s*(\d{2,5})\b|ListenAndServe\(\s*"[^"]*:(\d{2,5})"/)[0];
  if (port === undefined && listenLiteral) {
    port = Number(listenLiteral.m[1] ?? listenLiteral.m[2] ?? listenLiteral.m[3]);
    source = 'listen';
    evidence.push(`${listenLiteral.file}:${listenLiteral.line}`);
    if (!readsPortEnv) {
      warnings.push({
        code: 'PORT_HARDCODED',
        severity: 'warning',
        messageFa: fa.analyzer.portHardcoded(port),
        fixFa: fa.analyzer.portHardcodedFix,
        evidence: `${listenLiteral.file}:${listenLiteral.line}`,
      });
    }
  }

  const expose = /^\s*EXPOSE\s+(\d{2,5})/m.exec(readText(root, 'Dockerfile') ?? '');
  if (expose && (port === undefined || platform === 'docker')) {
    port = Number(expose[1]);
    source = 'expose';
    evidence.push('Dockerfile: EXPOSE');
  }

  const cliFlag = find(files.concat([{ file: 'Procfile', lines: (readText(root, 'Procfile') ?? '').split('\n') }]), /--port[=\s]+(\d{2,5})|--bind[=\s]+[\d.]+:(\d{2,5})/)[0];
  if (port === undefined && cliFlag) {
    port = Number(cliFlag.m[1] ?? cliFlag.m[2]);
    source = 'cli-flag';
    evidence.push(`${cliFlag.file}:${cliFlag.line}`);
  }

  if (port === undefined) {
    port = PLATFORM_DEFAULT_PORT[platform];
    warnings.push({
      code: 'PORT_DEFAULT_ASSUMED',
      severity: 'info',
      messageFa: fa.analyzer.portDefaultAssumed(port),
      fixFa: fa.analyzer.portDefaultAssumedFix,
    });
  }

  // Binding: listen(port, 'localhost') / host="127.0.0.1" / --host 127.0.0.1 / flask app.run() without host
  let bindHost: string | undefined;
  const local = find(files, /(?:listen\([^)]*,\s*|host\s*=\s*|--host[=\s]+)['"]?(localhost|127\.0\.0\.1)['"]?/)[0];
  const anyHost = find(files, /(?:listen\([^)]*,\s*|host\s*=\s*|--host[=\s]+)['"]?(0\.0\.0\.0|::)['"]?/)[0];
  if (local) {
    bindHost = local.m[1];
    warnings.push({
      code: 'BIND_LOCALHOST',
      severity: 'blocker',
      messageFa: fa.analyzer.bindLocalhost(bindHost as string),
      fixFa: fa.analyzer.bindLocalhostFix,
      evidence: `${local.file}:${local.line}`,
    });
  } else if (anyHost) {
    bindHost = anyHost.m[1];
  } else if (platform === 'flask') {
    const run = find(files, /\bapp\.run\(\s*\)/)[0];
    if (run) {
      bindHost = '127.0.0.1';
      warnings.push({
        code: 'BIND_LOCALHOST',
        severity: 'blocker',
        messageFa: fa.analyzer.bindLocalhost('127.0.0.1'),
        fixFa: fa.analyzer.bindLocalhostFix,
        evidence: `${run.file}:${run.line}`,
      });
    }
  }

  return { port, source, readsPortEnv, bindHost, evidence, warnings };
}
