import { clusterLogs } from '../log-cluster.js';
import { logsOf, signal } from './helpers.js';
import type { Detector } from './types.js';

/** Code detectors (T7.5): unhandled-exception, release-regression. */

export const unhandledException: Detector = (s) => {
  const clusters = clusterLogs(logsOf(s)).filter((c) => c.isUserCode);
  if (clusters.length === 0) return [];
  const top = [...clusters].sort((a, b) => b.count - a.count)[0]!;
  const frame = top.topFrames.find((f) => f.isUserCode);
  return [
    signal(
      'unhandled-exception',
      top.count >= 5 ? 'critical' : 'warn',
      {
        logRefs: [{ ts: top.firstSeen, snippet: top.sample.split('\n').slice(0, 3).join('\n').slice(0, 240) }],
        metric: { clusters: clusters.length, count: top.count },
      },
      frame ? `${frame.file}:${frame.line ?? '?'}` : undefined,
    ),
  ];
};

/**
 * Errors started after the last deploy: the deploy is inside the window, there are error records after
 * it and none before it (while the window did have earlier logs).
 */
export const releaseRegression: Detector = (s) => {
  if (!s.sources.lastDeploy.ok || !s.sources.lastDeploy.value) return [];
  const deployedAt = Date.parse(s.sources.lastDeploy.value.startedAt);
  const windowStart = Date.parse(s.takenAt) - s.windowSec * 1000;
  if (!Number.isFinite(deployedAt) || deployedAt < windowStart) return [];
  const logs = logsOf(s);
  const before = logs.filter((r) => r.ts < deployedAt);
  const errorsBefore = before.filter((r) => r.level === 'error');
  const errorsAfter = logs.filter((r) => r.ts >= deployedAt && r.level === 'error');
  if (before.length === 0 || errorsBefore.length > 0 || errorsAfter.length === 0) return [];
  const d = s.sources.lastDeploy.value;
  return [
    signal(
      'release-regression',
      'warn',
      {
        logRefs: errorsAfter.slice(0, 3).map((r) => ({ ts: r.ts, snippet: r.text.split('\n')[0]!.slice(0, 240) })),
        metric: { deploymentId: d.id, version: d.version, errorsAfter: errorsAfter.length },
      },
      d.version ?? d.id,
    ),
  ];
};
