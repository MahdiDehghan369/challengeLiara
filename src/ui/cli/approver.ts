import * as clack from '@clack/prompts';
import pc from 'picocolors';
import type { ApprovalDecision, Approver } from '../../safety/approval.js';
import { Risk, riskLabel, type ActionPlan } from '../../safety/risk.js';
import { redactText } from '../../safety/redact.js';
import { toman, withLtr } from './format.js';
import { fa } from './i18n/fa.js';

/**
 * CLI approval card (T9.5). Shows the ActionPlan and asks according to risk:
 * R1 run / no / run and don't ask again this session · R2 run / no / edit params · R3 type the app name.
 * `--yes` auto-approves R1 only; R2/R3 always need an interactive decision (denied without a TTY).
 */

export const CANCELLED = Symbol('cancelled');

export interface SelectOption<V extends string> {
  value: V;
  label: string;
}

/** Input abstraction so tests can script answers. */
export interface Prompter {
  note(body: string, title: string): void;
  select<V extends string>(message: string, options: SelectOption<V>[]): Promise<V | typeof CANCELLED>;
  text(message: string, opts?: { initialValue?: string; validate?: (v: string) => string | undefined }): Promise<string | typeof CANCELLED>;
}

export class ClackPrompter implements Prompter {
  note(body: string, title: string): void {
    clack.note(body, title);
  }

  async select<V extends string>(message: string, options: SelectOption<V>[]): Promise<V | typeof CANCELLED> {
    const r = await clack.select<V>({ message, options: options.map((o) => ({ value: o.value, label: o.label })) as never });
    return clack.isCancel(r) ? CANCELLED : (r as V);
  }

  async text(
    message: string,
    opts: { initialValue?: string; validate?: (v: string) => string | undefined } = {},
  ): Promise<string | typeof CANCELLED> {
    const validate = opts.validate;
    const r = await clack.text({
      message,
      ...(opts.initialValue !== undefined ? { initialValue: opts.initialValue } : {}),
      ...(validate ? { validate: (v: string | undefined) => validate(v ?? '') } : {}),
    });
    return clack.isCancel(r) ? CANCELLED : r;
  }
}

export interface CliApproverOptions {
  /** `--yes`: auto-approve R1 only. */
  yes?: boolean;
  /** Whether a human can answer (stdin is a TTY). Defaults to `process.stdin.isTTY`. */
  interactive?: boolean;
  prompter?: Prompter;
  /** Colour the risk line (default: picocolors' own detection). */
  color?: boolean;
}

const riskColor = (r: Risk, s: string, colors: ReturnType<typeof pc.createColors>): string =>
  r >= Risk.R3 ? colors.bold(colors.red(s)) : r === Risk.R2 ? colors.yellow(s) : r === Risk.R1 ? colors.green(s) : colors.dim(s);

function costLine(plan: ActionPlan): string {
  const parts: string[] = [];
  if (plan.costToman?.monthly) parts.push(`${toman(plan.costToman.monthly)} ${fa.approval.card.perMonth}`);
  if (plan.costToman?.oneTime) parts.push(`${toman(plan.costToman.oneTime)} ${fa.approval.card.oneTime}`);
  return parts.length ? parts.join(' + ') : fa.approval.card.costNone;
}

/** The card body. Persian lines and LTR fragments (names, commands) are kept on separate lines. */
export function renderPlanCard(plan: ActionPlan, opts: { color?: boolean } = {}): string {
  const c = fa.approval.card;
  const colors = pc.createColors(opts.color ?? pc.isColorSupported);
  const target = [plan.target.app, plan.target.resource].filter((s): s is string => !!s).join(' / ');
  const lines = [
    `${c.what} ${plan.titleFa}`,
    `${c.why} ${plan.reasonFa}`,
    ...(target ? [withLtr(c.target, target)] : []),
    `${c.cost} ${costLine(plan)}`,
    `${c.risk} ${riskColor(plan.risk, `${riskLabel(plan.risk)} — ${c.riskNames[plan.risk]}`, colors)}`,
    ...(plan.escalations?.length ? [withLtr(c.escalated, plan.escalations.join(', '))] : []),
    `${c.impact} ${plan.impactFa}`,
    `${c.rollback} ${plan.rollbackFa}`,
    withLtr(c.command, redactText(plan.command)),
  ];
  return lines.join('\n');
}

/** The name an R3 action must be confirmed with. */
export function confirmationName(plan: ActionPlan): string {
  return plan.target.app ?? plan.target.resource ?? plan.toolName;
}

export class CliApprover implements Approver {
  private readonly prompter: Prompter;
  private readonly interactive: boolean;

  constructor(private readonly opts: CliApproverOptions = {}) {
    this.prompter = opts.prompter ?? new ClackPrompter();
    this.interactive = opts.interactive ?? process.stdin.isTTY === true;
  }

  async request(plan: ActionPlan): Promise<ApprovalDecision> {
    if (plan.risk === Risk.R0) return 'approved';
    if (this.opts.yes && plan.risk === Risk.R1) return 'approved';

    const card = renderPlanCard(plan, this.opts.color !== undefined ? { color: this.opts.color } : {});
    if (!this.interactive) {
      // never auto-approve R2/R3 (or R1 without --yes) when nobody can answer
      this.prompter.note(
        `${card}\n\n${this.opts.yes ? fa.approval.yesOnlyR1 : fa.approval.nonInteractive}`,
        fa.approval.card.title,
      );
      return 'denied';
    }
    this.prompter.note(card, fa.approval.card.title);
    if (this.opts.yes) this.prompter.note(fa.approval.yesOnlyR1, fa.approval.card.title);

    if (plan.risk >= Risk.R3) return this.askName(plan);
    if (plan.risk === Risk.R2) return this.askR2(plan);
    return this.askR1();
  }

  private async askR1(): Promise<ApprovalDecision> {
    const ch = fa.approval.choice;
    const r = await this.prompter.select(ch.question, [
      { value: 'run', label: ch.run },
      { value: 'no', label: ch.no },
      { value: 'session', label: ch.session },
    ]);
    return r === 'run' ? 'approved' : r === 'session' ? 'approved-session' : 'denied';
  }

  private async askR2(plan: ActionPlan): Promise<ApprovalDecision> {
    const ch = fa.approval.choice;
    const r = await this.prompter.select(ch.question, [
      { value: 'run', label: ch.run },
      { value: 'no', label: ch.no },
      { value: 'edit', label: ch.edit },
    ]);
    if (r === 'run') return 'approved';
    if (r !== 'edit') return 'denied';
    const parse = (v: string): Record<string, unknown> | undefined => {
      try {
        const o: unknown = JSON.parse(v);
        return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : undefined;
      } catch {
        return undefined;
      }
    };
    const text = await this.prompter.text(fa.approval.editParams, {
      initialValue: JSON.stringify(plan.params),
      validate: (v) => (parse(v) ? undefined : fa.approval.invalidJson),
    });
    if (text === CANCELLED) return 'denied';
    const edited = parse(text);
    // the gate re-assesses risk and asks again if editing raised it
    return edited ? { edited } : 'denied';
  }

  private async askName(plan: ActionPlan): Promise<ApprovalDecision> {
    const name = confirmationName(plan);
    const typed = await this.prompter.text(fa.approval.typeName(name));
    if (typed !== CANCELLED && typed.trim() === name) return 'approved';
    this.prompter.note(fa.approval.nameMismatch, fa.approval.card.title);
    return 'denied';
  }
}
