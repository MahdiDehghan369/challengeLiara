import type { DeployEvent, DeployOptions, DeployStage } from '../../liara/index.js';

/** CLI deploy strategy (T5.7): `liara deploy` with stage events; raw lines only for `--verbose`. */

export interface DeployProgress {
  stage?(stage: DeployStage): void;
  percent?(p: number): void;
  /** Raw output line (shown only in verbose mode). */
  line?(line: string): void;
}

export interface StrategyResult {
  result: 'success' | 'failed' | 'timeout';
  version?: string;
  releaseID?: string;
  sourceID?: string;
  archiveSha256?: string;
  /** Last log lines for the failure report. */
  tail: string[];
  evidence: string[];
}

export interface CliDeployer {
  deploy(opts: DeployOptions): AsyncIterable<DeployEvent>;
}

export async function deployViaCli(cli: CliDeployer, opts: DeployOptions, progress: DeployProgress = {}): Promise<StrategyResult> {
  let version: string | undefined;
  for await (const e of cli.deploy(opts)) {
    switch (e.type) {
      case 'line':
        progress.line?.(e.line);
        if (e.percent !== undefined) progress.percent?.(e.percent);
        break;
      case 'stage':
        progress.stage?.(e.stage);
        break;
      case 'version':
        version = e.version;
        break;
      case 'done':
        return { result: 'success', ...(e.version ?? version ? { version: (e.version ?? version) as string } : {}), tail: [], evidence: ['cli: exit 0'] };
      case 'failed':
        return {
          result: e.timedOut ? 'timeout' : 'failed',
          ...(version ? { version } : {}),
          tail: e.tail,
          evidence: [`cli: ${e.timedOut ? 'timeout' : `exit ${String(e.exitCode)}`}`],
        };
    }
  }
  // the CLI wrapper always ends with done/failed; reaching here means the stream was cut
  return { result: 'failed', tail: [], evidence: ['cli: stream ended without a result'] };
}
