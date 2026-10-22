import type { LogLine } from '../liara/api/logs.js';
import { defaultRedactor, type Redactor } from '../safety/redact.js';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/** A normalized, redacted log record. Multi-line stack traces are merged into one record. */
export interface LogRecord {
  ts: number;
  /** Liara's `type` (stdout / stderr / …), preserved. */
  stream: string;
  level: LogLevel;
  text: string;
  lineCount: number;
}

export interface LogSource {
  getLogs(name: string, opts: { windowSec?: number; sinceTs?: number }): Promise<LogLine[]>;
}

export interface CollectOptions {
  windowSec?: number;
  /** Keep at most the newest N records. */
  max?: number;
  redactor?: Redactor;
}

const PINO_LEVELS: Record<number, LogLevel> = { 10: 'debug', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'error' };

function levelFromJson(text: string): LogLevel | undefined {
  const t = text.trim();
  if (!t.startsWith('{')) return undefined;
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    const l = o.level ?? o.severity ?? o.lvl ?? o.levelname;
    if (typeof l === 'number') return PINO_LEVELS[l] ?? (l >= 50 ? 'error' : l >= 40 ? 'warn' : 'info');
    if (typeof l === 'string') {
      const s = l.toLowerCase();
      if (/^(err|error|fatal|crit|critical|alert|emerg)/.test(s)) return 'error';
      if (/^warn/.test(s)) return 'warn';
      if (/^(debug|trace)/.test(s)) return 'debug';
      return 'info';
    }
  } catch {
    // not JSON
  }
  return undefined;
}

const ERROR_RE =
  /\b(ERROR|FATAL|CRITICAL|PANIC)\b|\b\w*(Error|Exception):|Traceback \(most recent call last\)|UnhandledPromiseRejection|Unhandled ?Rejection|uncaughtException|npm ERR!|Segmentation fault|out of memory|\bKilled\b/;
const WARN_RE = /\b(WARN|WARNING)\b|DeprecationWarning|\(node:\d+\) Warning/i;

export function detectLevel(text: string): LogLevel {
  const fromJson = levelFromJson(text);
  if (fromJson) return fromJson;
  if (ERROR_RE.test(text)) return 'error';
  if (WARN_RE.test(text)) return 'warn';
  if (/\bDEBUG\b/.test(text)) return 'debug';
  return 'info';
}

const NODE_FRAME_RE = /^\s+at\s/;
const PY_TRACEBACK_RE = /^Traceback \(most recent call last\):/;
const PY_FINAL_RE = /^[A-Za-z_][\w.]*(Error|Exception|Exit|Interrupt)\b/;

/** Merges consecutive lines of the same stream that belong to one stack trace. */
export function mergeMultiline(lines: LogLine[]): Array<{ ts: number; stream: string; text: string; lineCount: number }> {
  const out: Array<{ ts: number; stream: string; text: string; lineCount: number; inPyTrace: boolean }> = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    const sameStream = prev && prev.stream === l.stream;
    const isNodeFrame = NODE_FRAME_RE.test(l.text);
    const indented = /^\s+\S/.test(l.text);
    const continues =
      sameStream &&
      prev &&
      (isNodeFrame ||
        (prev.inPyTrace && (indented || PY_FINAL_RE.test(l.text))) ||
        // "    ^" caret / code excerpt lines right after a frame header
        (/^\s*\^+\s*$/.test(l.text) && prev.lineCount > 0));
    if (continues && prev) {
      prev.text += `\n${l.text}`;
      prev.lineCount += 1;
      // the "XxxError: msg" line closes a python traceback
      if (prev.inPyTrace && !indented && PY_FINAL_RE.test(l.text)) prev.inPyTrace = false;
    } else {
      out.push({ ts: l.ts, stream: l.stream, text: l.text, lineCount: 1, inPyTrace: PY_TRACEBACK_RE.test(l.text) });
    }
  }
  return out.map(({ inPyTrace: _ignored, ...r }) => r);
}

/** Fetches recent logs, merges stack traces, detects levels and redacts every record. */
export async function collectLogs(source: LogSource, app: string, opts: CollectOptions = {}): Promise<LogRecord[]> {
  const redactor = opts.redactor ?? defaultRedactor;
  const lines = await source.getLogs(app, { windowSec: opts.windowSec ?? 3600 });
  const sorted = [...lines].sort((a, b) => a.ts - b.ts);
  const records = mergeMultiline(sorted).map((r) => ({
    ts: r.ts,
    stream: r.stream,
    level: detectLevel(r.text),
    text: redactor.redactText(r.text),
    lineCount: r.lineCount,
  }));
  return opts.max !== undefined && records.length > opts.max ? records.slice(-opts.max) : records;
}
