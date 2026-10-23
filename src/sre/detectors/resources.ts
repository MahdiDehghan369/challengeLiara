import { eventsOf, logSignal, matchLogs, ref, signal } from './helpers.js';
import type { Detector, Signal } from './types.js';

/** Resource detectors (T7.5): oom, memory-leak-trend, cpu-saturation, disk-full, read-only-fs. */

export const MEMORY_NEAR_LIMIT_PCT = 95;
export const CPU_SATURATION_PCT = 90;
export const DISK_WARN_PCT = 90;
export const DISK_CRITICAL_PCT = 98;

const OOM_LOG_RE = /(JavaScript heap out of memory|Allocation failed|OOMKilled|\bKilled\b|exit(?:ed)? (?:with )?code 137|MemoryError|out of memory)/i;

export const oom: Detector = (s) => {
  const logs = matchLogs(s, OOM_LOG_RE);
  const events = eventsOf(s).filter((e) => e.kind === 'oom');
  if (logs.records.length || events.length) {
    return [signal('oom', 'critical', { logRefs: logs.records.slice(0, 3).map(ref), events: events.map((e) => e.message) }, logs.capture)];
  }
  if (!s.sources.metrics.ok) return [];
  for (const a of s.sources.metrics.value.memory.applets) {
    const nearLimit = (a.percent.p95 ?? a.percent.max ?? 0) >= MEMORY_NEAR_LIMIT_PCT;
    if (nearLimit || a.sawtooth.detected) {
      return [
        signal('oom', nearLimit && a.sawtooth.detected ? 'critical' : 'warn', {
          metric: { applet: a.applet, maxPct: a.percent.max, p95Pct: a.percent.p95, sawtoothDrops: a.sawtooth.drops.length },
        }),
      ];
    }
  }
  return [];
};

export const memoryLeakTrend: Detector = (s) => {
  if (!s.sources.metrics.ok) return [];
  const a = s.sources.metrics.value.memory.applets.find((x) => x.growth.detected);
  if (!a) return [];
  return [signal('memory-leak-trend', 'warn', { metric: { applet: a.applet, growth: a.growth.growth, slopePerHour: a.growth.slopePerHour, r2: a.growth.r2 } })];
};

export const cpuSaturation: Detector = (s) => {
  if (!s.sources.metrics.ok) return [];
  const a = s.sources.metrics.value.cpu.applets.find((x) => (x.percent.p95 ?? 0) >= CPU_SATURATION_PCT);
  if (!a) return [];
  return [signal('cpu-saturation', 'warn', { metric: { applet: a.applet, p95Pct: a.percent.p95, maxPct: a.percent.max } })];
};

export const diskFull: Detector = (s) => {
  const out: Signal[] = logSignal('disk-full', 'critical', s, /(ENOSPC[^\n]*|No space left on device)/i);
  if (out.length) return out;
  if (!s.sources.disks.ok) return [];
  const full = s.sources.disks.value.find((d) => (d.usagePercent ?? 0) >= DISK_WARN_PCT);
  if (!full) return [];
  return [signal('disk-full', (full.usagePercent ?? 0) >= DISK_CRITICAL_PCT ? 'critical' : 'warn', { metric: { disk: full.name, usagePercent: full.usagePercent } }, full.name)];
};

export const readOnlyFs: Detector = (s) => logSignal('read-only-fs', 'critical', s, /(EROFS[^\n]*|read-only file system)/i);
