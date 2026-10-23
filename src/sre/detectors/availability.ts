import { appOf, eventsOf, fiveXxShare, logSignal, logsOf, probeOf, ref, signal } from './helpers.js';
import type { Detector } from './types.js';

/** Availability detectors (T7.5): app-down, crash-loop, http-5xx-rate, slow-response, tls-issue, port-mismatch. */

export const SLOW_P95_MS = 1500;
export const FIVE_XX_WARN = 0.2;
export const FIVE_XX_CRITICAL = 0.5;
const START_RE = /\b(listening on|server (?:is )?(?:running|started)|started server|Uvicorn running|Booting worker|Application startup complete)/i;

export const appDown: Detector = (s) => {
  const app = appOf(s);
  if (app && app.scale === 0) return [signal('app-down', 'critical', { metric: { scale: 0 } }, 'scale=0')];
  const p = probeOf(s);
  if (!p || p.total === 0) return [];
  const gateway = (p.statusHistogram['502'] ?? 0) + (p.statusHistogram['503'] ?? 0);
  if (p.availability === 0 || gateway === p.total) {
    return [signal('app-down', 'critical', { probe: { url: p.url, availability: p.availability, statusHistogram: p.statusHistogram, errorHistogram: p.errorHistogram } })];
  }
  return [];
};

export const crashLoop: Detector = (s) => {
  const events = eventsOf(s);
  const crashes = events.filter((e) => e.kind === 'crash' || e.kind === 'oom');
  const restarts = events.filter((e) => e.kind === 'restart');
  const starts = logsOf(s).filter((r) => START_RE.test(r.text));
  if (crashes.length >= 2 || (crashes.length >= 1 && restarts.length >= 2) || starts.length >= 3) {
    return [
      signal('crash-loop', 'critical', {
        events: [...crashes, ...restarts].slice(-5).map((e) => e.message),
        ...(starts.length >= 3 ? { logRefs: starts.slice(-3).map(ref) } : {}),
        metric: { crashes: crashes.length, restarts: restarts.length, starts: starts.length },
      }),
    ];
  }
  return [];
};

export const http5xxRate: Detector = (s) => {
  const p = probeOf(s);
  // nothing answering at all is app-down, not an error rate
  if (!p || p.total === 0 || p.availability === 0) return [];
  const share = fiveXxShare(p);
  if (share < FIVE_XX_WARN) return [];
  return [signal('http-5xx-rate', share >= FIVE_XX_CRITICAL ? 'critical' : 'warn', { probe: { url: p.url, share, statusHistogram: p.statusHistogram } })];
};

export const slowResponse: Detector = (s) => {
  const p = probeOf(s);
  if (!p || p.p95 === undefined || p.p95 < SLOW_P95_MS) return [];
  return [signal('slow-response', p.p95 >= SLOW_P95_MS * 3 ? 'critical' : 'warn', { probe: { url: p.url, p50: p.p50, p95: p.p95 } })];
};

export const tlsIssue: Detector = (s) => {
  const p = probeOf(s);
  if (!p || (p.tlsValid !== false && p.errorHistogram.tls === 0)) return [];
  return [signal('tls-issue', 'critical', { probe: { url: p.url, tlsValid: p.tlsValid, errorHistogram: p.errorHistogram } })];
};

export const portMismatch: Detector = (s) => {
  const fromLogs = logSignal('port-mismatch', 'critical', s, /(EADDRINUSE[^\n]*|listening (?:on|at) (?:https?:\/\/)?(?:localhost|127\.0\.0\.1)[^\n]*)/i);
  if (fromLogs.length) return fromLogs;
  // running but refusing connections: the app listens elsewhere
  const p = probeOf(s);
  const app = appOf(s);
  if (p && app?.scale === 1 && p.errorHistogram.connection > 0 && p.availability === 0) {
    return [signal('port-mismatch', 'warn', { probe: { url: p.url, errorHistogram: p.errorHistogram } })];
  }
  return [];
};
