import { waitAppRunning, type LiaraClient, type WaitOptions } from '../../liara/index.js';
import { ExternalCommandError } from '../../shared/errors.js';
import { round } from '../../shared/stats.js';
import { matchKnowledge, type CompiledPattern } from '../../sre/knowledge/index.js';
import { clusterLogs } from '../../sre/log-cluster.js';
import { collectLogs } from '../../sre/logs.js';
import { probe, type ProbeOptions, type ProbeResult } from '../../sre/health.js';
import type { Prompter } from '../../ui/cli/approver.js';
import { fa } from '../../ui/cli/i18n/fa.js';
import type { Step } from '../pipeline-engine.js';
import type { DeployStepState } from './deploy.js';

/**
 * Verify (T5.8): wait until running → probe `/health` and `/` on the default URL → crash/OOM events and
 * error logs of the first minute → verdict healthy / degraded / failed with reasons → `healthAfter` in
 * the ledger. Unhealthy → hand-off message + `onUnhealthy` (TODO(T8.12): the SRE cycle).
 * TODO(T7.9): smoke test on the project's routes once implemented.
 */

export type HealthVerdict = 'healthy' | 'degraded' | 'failed';

export interface VerifyResult {
  verdict: HealthVerdict;
  score: number;
  url: string;
  reasonsFa: string[];
  availability: number | undefined;
  crashEvents: string[];
  errorClusters: number;
  knownPatterns: Array<{ id: string; titleFa: string }>;
}

export interface VerifyState extends DeployStepState {
  verify?: VerifyResult;
}

/**
 * Default app URL. TODO(BEHAVIOR §9, T0.8): confirm `https://<name>.liara.run` and the
 * `default-subdomain` effect; until then injectable (the mock serves local URLs).
 */
export const defaultAppUrl = (app: string): string => `https://${app}.liara.run`;

export interface VerifyDeps {
  liara: Pick<LiaraClient, 'apps' | 'events' | 'logs' | 'ledger'>;
  ui: Prompter;
  urlFor?: (app: string) => string | Promise<string>;
  probe?: Pick<ProbeOptions, 'count' | 'timeoutMs' | 'fetchImpl'>;
  wait?: Pick<WaitOptions<unknown>, 'timeoutMs' | 'intervalMs' | 'sleep'>;
  /** Observation window after the deploy started (default 60 s). */
  observeMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  knowledge?: CompiledPattern[];
  /** TODO(T8.12): the SRE cycle takes over here. */
  onUnhealthy?: (result: VerifyResult) => Promise<void> | void;
}

/** Pure verdict from the observations. */
export function judgeHealth(input: {
  running: boolean;
  url: string;
  probe: ProbeResult | undefined;
  crashEvents: string[];
  errorClusters: number;
  knownPatterns: Array<{ id: string; titleFa: string }>;
}): Pick<VerifyResult, 'verdict' | 'score' | 'reasonsFa'> {
  const v = fa.verify;
  const reasons: string[] = [];
  const availability = input.probe?.availability;
  if (!input.running) reasons.push(v.notRunning);
  if (availability === 0) reasons.push(v.unavailable(input.url));
  else if (availability !== undefined && availability < 100) reasons.push(v.partial(availability));
  if (input.crashEvents.length > 0) reasons.push(v.crashEvents(input.crashEvents.length));
  if (input.errorClusters > 0) reasons.push(v.errorLogs(input.errorClusters));
  for (const k of input.knownPatterns) reasons.push(v.known(k.titleFa));

  const failed = !input.running || availability === 0 || availability === undefined || input.crashEvents.length > 0;
  const degraded = !failed && ((availability ?? 0) < 100 || input.errorClusters > 0);
  const base = input.running ? (availability ?? 0) : 0;
  const score = Math.max(0, Math.min(100, round(base - 15 * Math.min(input.errorClusters, 3) - (input.crashEvents.length > 0 ? 50 : 0), 0)));
  return { verdict: failed ? 'failed' : degraded ? 'degraded' : 'healthy', score: failed ? Math.min(score, 30) : score, reasonsFa: reasons };
}

export function verifyStep<S extends VerifyState>(deps: VerifyDeps): Step<S> {
  const v = fa.verify;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return {
    id: 'verify',
    titleFa: v.title,
    onFail: 'diagnose',
    run: async (ctx) => {
      const s = ctx.state;
      const app = s.appName;
      if (!app) throw new Error('verify needs the analyze step first');
      const rec = s.deployment ? deps.liara.ledger.list(app).find((r) => r.id === s.deployment!.id) : undefined;
      const deployStarted = rec ? Date.parse(rec.startedAt) : now();

      // 1) running?
      ctx.setStatus('running', v.waitingRunning);
      let running = true;
      try {
        await waitAppRunning(deps.liara.apps, app, deps.wait ?? {});
      } catch {
        running = false;
      }

      // 2) probe the default URL
      const url = await (deps.urlFor ?? defaultAppUrl)(app);
      let probeResult: ProbeResult | undefined;
      if (running) {
        ctx.setStatus('running', v.probing);
        probeResult = await probe(url, { paths: ['/health', '/'], count: 2, timeoutMs: 10_000, ...deps.probe });
      }

      // 3) first minute of events and logs
      ctx.setStatus('running', v.observing);
      const remaining = deployStarted + (deps.observeMs ?? 60_000) - now();
      if (remaining > 0) await sleep(remaining);
      const sinceSec = Math.floor(deployStarted / 1000);
      const events = await deps.liara.events.getEvents(app, { start: sinceSec }).catch(() => []);
      const crashEvents = events.filter((e) => (e.kind === 'crash' || e.kind === 'oom') && (e.ts === undefined || e.ts >= sinceSec * 1000)).map((e) => e.message);
      const windowSec = Math.max(60, Math.ceil((now() - deployStarted) / 1000) + 5);
      const logs = (await collectLogs(deps.liara.logs, app, { windowSec }).catch(() => [])).filter((r) => r.ts >= sinceSec * 1000);
      const clusters = clusterLogs(logs);
      const knownPatterns = new Map<string, string>();
      for (const c of clusters) {
        for (const m of matchKnowledge(c.sample, { first: true, ...(deps.knowledge ? { patterns: deps.knowledge } : {}) })) {
          knownPatterns.set(m.pattern.id, m.pattern.titleFa);
        }
      }

      const judged = judgeHealth({
        running,
        url,
        probe: probeResult,
        crashEvents,
        errorClusters: clusters.length,
        knownPatterns: [...knownPatterns].map(([id, titleFa]) => ({ id, titleFa })),
      });
      const result: VerifyResult = {
        ...judged,
        url,
        availability: probeResult?.availability,
        crashEvents,
        errorClusters: clusters.length,
        knownPatterns: [...knownPatterns].map(([id, titleFa]) => ({ id, titleFa })),
      };
      s.verify = result;
      if (rec) deps.liara.ledger.update(app, rec.id, { healthAfter: { score: result.score, verdict: result.verdict } });

      if (result.verdict === 'healthy') {
        ctx.setStatus('running', v.healthy(url));
        return;
      }
      deps.ui.note([v.handoff, ...result.reasonsFa.map((r) => `• ${r}`)].join('\n'), v.resultTitle);
      await deps.onUnhealthy?.(result);
      if (result.verdict === 'failed') {
        throw new ExternalCommandError(`verify: ${result.verdict}`, {
          messageFa: v.handoff,
          details: { app, verdict: result.verdict, score: result.score, reasons: result.reasonsFa },
        });
      }
    },
  };
}
