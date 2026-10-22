import type { LogLevel, LogRecord } from './logs.js';

export interface StackFrame {
  file: string;
  line: number | undefined;
  fn: string | undefined;
  isUserCode: boolean;
}

export interface LogCluster {
  signature: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  /** Text of the first record in the cluster (already redacted by collectLogs). */
  sample: string;
  level: LogLevel;
  stream: string;
  topFrames: StackFrame[];
  /** True if any frame of the sample points into the user's project (not deps / runtime). */
  isUserCode: boolean;
}

const NON_USER_RE = /node_modules|site-packages|dist-packages|^node:|^internal\/|\(internal\/|\/usr\/lib\/python|\/usr\/local\/lib\/python|<frozen |\/vendor\//;

export function isUserFile(file: string): boolean {
  return !NON_USER_RE.test(file);
}

const NODE_FRAME_RE = /^\s*at\s+(?:(?:async\s+)?(.+?)\s+\()?(.+?):(\d+):\d+\)?\s*$/;
const PY_FRAME_RE = /^\s*File "(.+?)", line (\d+)(?:, in (.+))?/;

/** Extracts stack frames (Node `at fn (file:line:col)` and Python `File "x", line N, in fn`). */
export function parseFrames(text: string): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const l of text.split('\n')) {
    const n = NODE_FRAME_RE.exec(l);
    if (n && /^\s*at\s/.test(l)) {
      const file = (n[2] as string).replace(/^file:\/\//, '');
      frames.push({ file, line: Number(n[3]), fn: n[1]?.trim(), isUserCode: isUserFile(file) });
      continue;
    }
    const p = PY_FRAME_RE.exec(l);
    if (p) frames.push({ file: p[1] as string, line: Number(p[2]), fn: p[3]?.trim(), isUserCode: isUserFile(p[1] as string) });
  }
  // Python lists the innermost frame last; put the most relevant (innermost) first for both runtimes
  return text.includes('Traceback (most recent call last)') ? frames.reverse() : frames;
}

/** Normalizes variable parts of an error header so identical errors share a signature. */
export function normalizeMessage(s: string): string {
  return s
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<ts>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b[0-9a-f]{12,}\b/gi, '<hex>')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '<ip>')
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '<email>')
    .replace(/(["'])(?:(?!\1).){25,}\1/g, '$1<str>$1')
    .replace(/(?:[A-Za-z]:)?(?:\/[\w.@-]+){2,}/g, '<path>')
    .replace(/\b\d+(?:\.\d+)?\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

export function errorSignature(text: string): string {
  const lines = text.split('\n');
  const header = lines.find((l) => /\w/.test(l) && !/^Traceback/.test(l)) ?? lines[0] ?? '';
  // For Python the exception line is last; prefer it as header
  const pyFinal = text.includes('Traceback (most recent call last)') ? lines[lines.length - 1] : undefined;
  const frames = parseFrames(text);
  const top = frames.find((f) => f.isUserCode) ?? frames[0];
  const where = top ? ` @${top.fn ?? '?'}:${basename(top.file)}` : '';
  return `${normalizeMessage((pyFinal ?? header).slice(0, 300))}${where}`;
}

export interface ClusterOptions {
  levels?: LogLevel[];
}

/** Groups records by error signature; sorted by count desc, then most recent. */
export function clusterLogs(records: LogRecord[], opts: ClusterOptions = {}): LogCluster[] {
  const levels = new Set(opts.levels ?? ['error']);
  const map = new Map<string, LogCluster>();
  for (const r of records) {
    if (!levels.has(r.level)) continue;
    const sig = errorSignature(r.text);
    const c = map.get(sig);
    if (c) {
      c.count += 1;
      c.firstSeen = Math.min(c.firstSeen, r.ts);
      c.lastSeen = Math.max(c.lastSeen, r.ts);
    } else {
      const frames = parseFrames(r.text);
      map.set(sig, {
        signature: sig,
        count: 1,
        firstSeen: r.ts,
        lastSeen: r.ts,
        sample: r.text,
        level: r.level,
        stream: r.stream,
        topFrames: frames.slice(0, 5),
        isUserCode: frames.some((f) => f.isUserCode),
      });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen);
}
