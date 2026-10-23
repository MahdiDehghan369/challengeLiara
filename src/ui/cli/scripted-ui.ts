import { CANCELLED, type Prompter, type SelectOption } from './approver.js';

/**
 * Scripted `Prompter` for tests and demos: answers come from a queue in order. An answer can be a
 * value, `CANCELLED`, or `{match, answer}` to assert which prompt it is for. Running out of answers
 * throws, so an unexpected prompt fails the test instead of hanging.
 */

export type ScriptedAnswer = string | typeof CANCELLED | { match: RegExp; answer: string | typeof CANCELLED };

export interface ScriptedPrompt {
  kind: 'select' | 'text';
  message: string;
  options?: string[];
  answer: string | typeof CANCELLED;
}

export class ScriptedUi implements Prompter {
  readonly notes: Array<{ title: string; body: string }> = [];
  readonly prompts: ScriptedPrompt[] = [];

  constructor(private readonly answers: ScriptedAnswer[] = []) {}

  get remaining(): number {
    return this.answers.length;
  }

  private next(kind: ScriptedPrompt['kind'], message: string): string | typeof CANCELLED {
    const a = this.answers.shift();
    if (a === undefined) throw new Error(`ScriptedUi: no scripted answer for ${kind} "${message}"`);
    if (typeof a === 'object') {
      if (!a.match.test(message)) throw new Error(`ScriptedUi: expected a prompt matching ${String(a.match)}, got "${message}"`);
      return a.answer;
    }
    return a;
  }

  note(body: string, title: string): void {
    this.notes.push({ title, body });
  }

  async select<V extends string>(message: string, options: SelectOption<V>[]): Promise<V | typeof CANCELLED> {
    const answer = this.next('select', message);
    this.prompts.push({ kind: 'select', message, options: options.map((o) => o.value), answer });
    if (answer !== CANCELLED && !options.some((o) => o.value === answer)) {
      throw new Error(`ScriptedUi: "${answer}" is not an option of "${message}" (${options.map((o) => o.value).join(', ')})`);
    }
    return answer as V | typeof CANCELLED;
  }

  async text(message: string, opts: { initialValue?: string; validate?: (v: string) => string | undefined } = {}): Promise<string | typeof CANCELLED> {
    let answer = this.next('text', message);
    // an empty scripted answer accepts the initial value, like pressing enter
    if (answer === '' && opts.initialValue !== undefined) answer = opts.initialValue;
    this.prompts.push({ kind: 'text', message, answer });
    if (answer !== CANCELLED && opts.validate) {
      const err = opts.validate(answer);
      if (err) {
        this.notes.push({ title: 'validation', body: err });
        return this.text(message, opts);
      }
    }
    return answer;
  }
}
