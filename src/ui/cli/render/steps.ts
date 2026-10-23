import pc from 'picocolors';
import type { PipelineEvent, StepStatus } from '../../../deploy/pipeline-engine.js';
import { redactText } from '../../../safety/redact.js';
import { formatNumber } from '../format.js';
import { fa } from '../i18n/fa.js';
import { progressLine, SPINNER_FRAMES } from './progress.js';

/**
 * Live step checklist for pipelines (T9.3): ⏳ ✅ ❌ ⏸ ⏭ with each step's time, a spinner on the
 * current step, an upload bar and a highlighted "waiting for you". TTY → redrawn frame; otherwise
 * one line per transition; `--json` → one JSON object per event.
 */

export type RenderMode = 'tty' | 'lines' | 'json';

export interface StepRow {
  id: string;
  titleFa: string;
  status: StepStatus;
  startedAt?: number;
  endedAt?: number;
  noteFa?: string;
}

export const STATUS_ICON: Record<StepStatus, string> = {
  pending: '○',
  running: '⏳',
  done: '✅',
  failed: '❌',
  skipped: '⏭',
  'waiting-human': '⏸',
  'waiting-approval': '⏸',
};

export interface StepsViewOptions {
  mode: RenderMode;
  write: (text: string) => void;
  now?: () => number;
  color?: boolean;
  /** Spinner redraw interval in TTY mode (ms); 0 disables the timer. */
  spinnerMs?: number;
}

const s = fa.steps;
const seconds = (ms: number) => s.seconds(formatNumber(ms / 1000, { decimals: 1 }));

export class StepsView {
  readonly rows: StepRow[] = [];
  private readonly now: () => number;
  private readonly colors: ReturnType<typeof pc.createColors>;
  private frame = 0;
  private drawnLines = 0;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly opts: StepsViewOptions) {
    this.now = opts.now ?? Date.now;
    this.colors = pc.createColors(opts.color ?? (opts.mode === 'tty' && pc.isColorSupported));
  }

  handle(e: PipelineEvent): void {
    if (this.opts.mode === 'json') {
      this.opts.write(JSON.stringify(redactJson(e)));
      return;
    }
    if (e.type === 'pipeline_start') {
      if (e.messageFa) this.opts.write(e.messageFa);
      this.startTimer();
      return;
    }
    if (e.type === 'pipeline_end') {
      this.stopTimer();
      if (this.opts.mode === 'tty') this.draw();
      this.opts.write(endMessage(e));
      return;
    }
    const row = this.upsert(e.stepId, e.titleFa);
    const changed = row.status !== e.status;
    if (e.status === 'running' && row.startedAt === undefined) row.startedAt = this.now();
    if (['done', 'failed', 'skipped'].includes(e.status)) row.endedAt = this.now();
    if (e.status === 'running' && changed && row.endedAt !== undefined) {
      // a retried step starts its clock again
      row.startedAt = this.now();
      delete row.endedAt;
    }
    row.status = e.status;
    if (e.noteFa !== undefined) row.noteFa = redactText(e.noteFa);
    else if (changed) delete row.noteFa;
    if (this.opts.mode === 'tty') this.draw();
    else if (changed || e.noteFa) this.opts.write(this.line(row, false));
  }

  /** The whole checklist (one line per step, plus a bar under a step that reports a percent). */
  renderFrame(): string {
    return this.rows.flatMap((r) => {
      const bar = r.status === 'running' ? progressLine(r.noteFa) : undefined;
      return [this.line(r, true), ...(bar ? [`     ${bar}`] : [])];
    }).join('\n');
  }

  stop(): void {
    this.stopTimer();
  }

  private upsert(id: string, titleFa: string): StepRow {
    let row = this.rows.find((r) => r.id === id);
    if (!row) {
      row = { id, titleFa, status: 'pending' };
      this.rows.push(row);
    }
    return row;
  }

  private line(r: StepRow, live: boolean): string {
    const c = this.colors;
    const icon = live && r.status === 'running' && this.opts.mode === 'tty' ? (SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length] as string) : STATUS_ICON[r.status];
    const waiting = r.status === 'waiting-human' || r.status === 'waiting-approval';
    const elapsed = r.startedAt !== undefined ? (r.endedAt ?? this.now()) - r.startedAt : undefined;
    const time = elapsed !== undefined && r.status !== 'pending' && !waiting ? ` (${seconds(elapsed)})` : '';
    let title = `${icon} ${r.titleFa}${time}`;
    if (waiting) title = c.bold(c.yellow(`${title} — ${r.status === 'waiting-human' ? s.waitingYou : s.waitingApproval}`));
    else if (r.status === 'failed') title = c.red(title);
    else if (r.status === 'done') title = c.green(title);
    else if (r.status === 'skipped' || r.status === 'pending') title = c.dim(title);
    const note = r.noteFa && (live || r.status !== 'done') ? `\n     ${r.noteFa}` : '';
    return `${title}${note}`;
  }

  private draw(): void {
    const text = this.renderFrame();
    // move up over the previous frame and clear it
    const clear = this.drawnLines > 0 ? `\x1b[${this.drawnLines}A\x1b[0J` : '';
    this.opts.write(`${clear}${text}`);
    this.drawnLines = text.split('\n').length;
  }

  private startTimer(): void {
    const ms = this.opts.spinnerMs ?? 100;
    if (this.opts.mode !== 'tty' || ms <= 0 || this.timer) return;
    this.timer = setInterval(() => {
      this.frame++;
      if (this.rows.some((r) => r.status === 'running')) this.draw();
    }, ms);
    this.timer.unref?.();
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

function endMessage(e: Extract<PipelineEvent, { type: 'pipeline_end' }>): string {
  if (e.status === 'done') return s.pipelineDone;
  if (e.status === 'waiting-human') return [s.pipelineWaiting, e.messageFa].filter(Boolean).join('\n');
  if (e.status === 'cancelled') return s.pipelineCancelled;
  return [s.pipelineFailed(e.failedStep ?? '?'), e.messageFa].filter(Boolean).join('\n');
}

function redactJson(e: PipelineEvent): PipelineEvent {
  return JSON.parse(redactText(JSON.stringify(e))) as PipelineEvent;
}

/** Picks the render mode: `--json` → json, a TTY → tty, otherwise plain lines. */
export function renderMode(opts: { json?: boolean; isTTY?: boolean }): RenderMode {
  return opts.json ? 'json' : opts.isTTY ? 'tty' : 'lines';
}
