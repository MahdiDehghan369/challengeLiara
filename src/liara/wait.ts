import { LiaraApiError } from '../shared/errors.js';
import { fa } from '../ui/cli/i18n/fa.js';
import type { AppsApi } from './api/apps.js';
import type { App } from './api/schemas/apps.js';

export interface WaitOptions<T> {
  timeoutMs?: number;
  intervalMs?: number;
  onTick?: (value: T, elapsedMs: number) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_INTERVAL_MS = 3_000;
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Polls `fn` until `predicate` holds. Async Liara actions (restart, scale, delete) only return
 * "accepted", so their outcome must always be confirmed through this (AGENT_RULES §1.10).
 * Throws `LiaraApiError('WAIT_TIMEOUT')` with the last observed value in `details.last`.
 */
export async function waitForState<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean | Promise<boolean>,
  opts: WaitOptions<T> = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const start = now();
  let last: T | undefined;
  for (;;) {
    last = await fn();
    const elapsed = now() - start;
    opts.onTick?.(last, elapsed);
    if (await predicate(last)) return last;
    if (elapsed + intervalMs > timeoutMs) {
      throw new LiaraApiError(`waitForState timed out after ${elapsed}ms`, {
        code: 'WAIT_TIMEOUT',
        messageFa: fa.wait.timeout,
        retryable: true,
        details: { timeoutMs, elapsedMs: elapsed, last },
      });
    }
    await sleep(intervalMs);
  }
}

/** Waits until the app disappears from `GET /v1/projects` (after delete). */
export async function waitAppGone(
  apps: AppsApi,
  name: string,
  opts: WaitOptions<App | undefined> = {},
): Promise<void> {
  await waitForState(() => apps.findApp(name, { fresh: true }), (a) => a === undefined, opts);
}

/** Waits until the app's `scale` equals the requested value (after scale 0/1). */
export async function waitAppScale(
  apps: AppsApi,
  name: string,
  scale: 0 | 1,
  opts: WaitOptions<App | undefined> = {},
): Promise<App> {
  const app = await waitForState(() => apps.findApp(name, { fresh: true }), (a) => a?.scale === scale, opts);
  return app as App;
}

export interface WaitRunningOptions extends WaitOptions<App | undefined> {
  /** Optional readiness check, e.g. an HTTP health probe; must resolve true when the app serves traffic. */
  probe?: () => Promise<boolean>;
}

/**
 * Waits until the app is on (`scale === 1`), not explicitly undeployed, and the optional probe passes.
 * TODO(OQ-7): once status values are known (BEHAVIOR §1/§8), also require a "running" status here.
 */
export async function waitAppRunning(apps: AppsApi, name: string, opts: WaitRunningOptions = {}): Promise<App> {
  const { probe, ...waitOpts } = opts;
  const app = await waitForState(
    () => apps.findApp(name, { fresh: true }),
    async (a) => !!a && a.scale === 1 && a.isDeployed !== false && (probe ? await probe() : true),
    waitOpts,
  );
  return app as App;
}
