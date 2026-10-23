import type { PipelineCheckpoint, Session } from '../agent/session.js';
import { isSiavashError } from '../shared/errors.js';
import { fa } from '../ui/cli/i18n/fa.js';

/**
 * Generic pipeline state machine (T5.1). Steps run in order; each transition is emitted for the UI
 * and checkpointed in the session, so a failed, cancelled or paused run resumes at the same step.
 * Cancellation is honoured between steps only (a running step gets the signal but is never cut off).
 *
 * The state must be plain JSON and must not hold secret values: the session is redacted on save.
 */

export type StepStatus = PipelineCheckpoint['steps'][string];
export type PipelineStatus = PipelineCheckpoint['status'];
export type OnFail = 'abort' | 'diagnose' | 'ask';
export type PipelineState = Record<string, unknown>;

export interface StepContext<S extends PipelineState> {
  state: S;
  signal?: AbortSignal;
  /** Marks the step as waiting for an approval or a human (and back to running). */
  setStatus(status: 'running' | 'waiting-approval' | 'waiting-human', noteFa?: string): void;
}

/** A step either finishes (`undefined` / `{status:'done'}`) or pauses the pipeline for a human step. */
export type StepOutcome = void | { status: 'done' } | { status: 'waiting-human'; messageFa: string };

export interface Step<S extends PipelineState> {
  id: string;
  titleFa: string;
  run(ctx: StepContext<S>): Promise<StepOutcome>;
  skipIf?(ctx: StepContext<S>): boolean | Promise<boolean>;
  onFail?: OnFail;
}

export interface Pipeline<S extends PipelineState> {
  id: string;
  steps: Array<Step<S>>;
}

export type PipelineEvent =
  | { type: 'pipeline_start'; pipelineId: string; resumedFrom?: string; messageFa?: string }
  | { type: 'step'; pipelineId: string; stepId: string; titleFa: string; status: StepStatus; noteFa?: string }
  | { type: 'pipeline_end'; pipelineId: string; status: PipelineStatus; failedStep?: string; messageFa?: string };

export type AskDecision = 'retry' | 'skip' | 'abort';

export interface RunPipelineOptions<S extends PipelineState> {
  state: S;
  session?: Session;
  /** Continue from the session checkpoint (done/skipped steps are not run again). */
  resume?: boolean;
  signal?: AbortSignal;
  onEvent?: (e: PipelineEvent) => void;
  /** `onFail: 'diagnose'`: explains the failure (e.g. RCA); the pipeline still stops. */
  diagnose?: (step: Step<S>, error: unknown, state: S) => Promise<string | undefined>;
  /** `onFail: 'ask'`: asks the user what to do. Without it, 'ask' behaves like 'abort'. */
  ask?: (step: Step<S>, error: unknown, state: S) => Promise<AskDecision>;
  /** Persist the session after each transition (default true). */
  persist?: boolean;
}

export interface PipelineResult<S extends PipelineState> {
  status: PipelineStatus;
  state: S;
  steps: Record<string, StepStatus>;
  failedStep?: string;
  error?: unknown;
  messageFa?: string;
  diagnosisFa?: string;
}

function errorFa(error: unknown, title: string): string {
  return isSiavashError(error) ? error.messageFa : fa.pipeline.stepFailed(title);
}

export async function runPipeline<S extends PipelineState>(pipeline: Pipeline<S>, opts: RunPipelineOptions<S>): Promise<PipelineResult<S>> {
  const ids = pipeline.steps.map((s) => s.id);
  if (new Set(ids).size !== ids.length) throw new Error(`pipeline ${pipeline.id}: duplicate step ids`);

  const cp = opts.resume ? opts.session?.checkpoint(pipeline.id) : undefined;
  const state = (cp ? { ...opts.state, ...cp.state } : opts.state) as S;
  const steps: Record<string, StepStatus> = Object.fromEntries(
    pipeline.steps.map((s) => {
      const prev = cp?.steps[s.id];
      return [s.id, prev === 'done' || prev === 'skipped' ? prev : 'pending'];
    }),
  );
  const emit = (e: PipelineEvent) => opts.onEvent?.(e);

  const checkpoint = (status: PipelineStatus, failedStep?: string) => {
    if (!opts.session) return;
    opts.session.setCheckpoint({
      pipelineId: pipeline.id,
      status,
      steps: { ...steps },
      state: JSON.parse(JSON.stringify(state)) as Record<string, unknown>,
      ...(failedStep ? { failedStep } : {}),
    });
    if (opts.persist !== false) opts.session.save();
  };

  const finish = (result: Omit<PipelineResult<S>, 'state' | 'steps'>): PipelineResult<S> => {
    checkpoint(result.status, result.failedStep);
    emit({
      type: 'pipeline_end',
      pipelineId: pipeline.id,
      status: result.status,
      ...(result.failedStep ? { failedStep: result.failedStep } : {}),
      ...(result.messageFa ? { messageFa: result.messageFa } : {}),
    });
    return { ...result, state, steps: { ...steps } };
  };

  const firstOpen = pipeline.steps.find((s) => steps[s.id] === 'pending');
  emit({
    type: 'pipeline_start',
    pipelineId: pipeline.id,
    ...(cp && firstOpen ? { resumedFrom: firstOpen.id, messageFa: fa.pipeline.resumed(firstOpen.titleFa) } : {}),
  });

  for (const step of pipeline.steps) {
    if (steps[step.id] !== 'pending') continue;
    if (opts.signal?.aborted) return finish({ status: 'cancelled', messageFa: fa.pipeline.cancelled });

    const set = (status: StepStatus, noteFa?: string) => {
      steps[step.id] = status;
      emit({ type: 'step', pipelineId: pipeline.id, stepId: step.id, titleFa: step.titleFa, status, ...(noteFa ? { noteFa } : {}) });
    };
    const ctx: StepContext<S> = {
      state,
      ...(opts.signal ? { signal: opts.signal } : {}),
      setStatus: (status, noteFa) => set(status, noteFa),
    };

    if (step.skipIf && (await step.skipIf(ctx))) {
      set('skipped');
      checkpoint('running');
      continue;
    }

    for (;;) {
      set('running');
      checkpoint('running');
      try {
        const outcome = await step.run(ctx);
        if (outcome && outcome.status === 'waiting-human') {
          // The step will run again on resume, after the human did their part.
          set('waiting-human', outcome.messageFa);
          steps[step.id] = 'pending';
          return finish({ status: 'waiting-human', failedStep: step.id, messageFa: outcome.messageFa });
        }
        set('done');
        checkpoint('running');
        break;
      } catch (error) {
        set('failed');
        const messageFa = errorFa(error, step.titleFa);
        const mode = step.onFail ?? 'abort';
        if (mode === 'ask' && opts.ask) {
          const decision = await opts.ask(step, error, state);
          if (decision === 'retry') continue;
          if (decision === 'skip') {
            set('skipped');
            checkpoint('running');
            break;
          }
        }
        let diagnosisFa: string | undefined;
        if (mode === 'diagnose' && opts.diagnose) {
          try {
            diagnosisFa = await opts.diagnose(step, error, state);
          } catch {
            // a failed diagnosis must not hide the original error
          }
        }
        return finish({ status: 'failed', failedStep: step.id, error, messageFa, ...(diagnosisFa ? { diagnosisFa } : {}) });
      }
    }
  }
  return finish({ status: 'done' });
}
