import type { z } from 'zod';
import { redactText } from '../safety/redact.js';
import { LlmError } from '../shared/errors.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { jsonObjectsIn } from './json-protocol.js';
import type { ChatMessage, LlmClient, ModelRole } from './types.js';

/**
 * Structured LLM output (T3.8): ask for JSON, validate with zod, ask once for a correction, then fail
 * with `LlmError` carrying the (redacted, truncated) raw output. Untrusted inputs always go inside
 * `<data>…</data>` so prompts can tell the model they are data, not instructions.
 */

/** Wraps untrusted text (logs, code, tool output) so it cannot close the data block. */
export function wrapData(text: string, label?: string): string {
  const safe = text.replace(/<\/data>/gi, '<\\/data>');
  return `<data${label ? ` source="${label.replace(/"/g, "'")}"` : ''}>\n${safe}\n</data>`;
}

export interface AskStructuredOptions<T> {
  role: ModelRole;
  /** The task prompt (system message). */
  prompt: string;
  /** Untrusted inputs, each wrapped in `<data>`. */
  data?: Array<{ label?: string; text: string }>;
  /** Extra instruction in the user message (trusted). */
  instruction?: string;
  schema: z.ZodType<T>;
  signal?: AbortSignal;
}

export interface StructuredResult<T> {
  value: T;
  model: string;
  attempts: number;
}

function issues(err: z.ZodError): string {
  return err.issues
    .slice(0, 8)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

export async function askStructured<T>(llm: LlmClient, opts: AskStructuredOptions<T>): Promise<StructuredResult<T>> {
  const user = [
    opts.instruction ?? 'Answer with one JSON object only.',
    ...(opts.data ?? []).map((d) => wrapData(d.text, d.label)),
  ].join('\n\n');
  let messages: ChatMessage[] = [
    { role: 'system', content: opts.prompt },
    { role: 'user', content: user },
  ];
  let lastRaw = '';
  let lastReason = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await llm.chat({ role: opts.role, messages, json: true, ...(opts.signal ? { signal: opts.signal } : {}) });
    lastRaw = res.content ?? '';
    const objects = jsonObjectsIn(lastRaw);
    if (objects.length === 0) {
      lastReason = 'no JSON object in the reply';
    } else {
      let firstError: z.ZodError | undefined;
      for (const o of objects) {
        const parsed = opts.schema.safeParse(o);
        if (parsed.success) return { value: parsed.data, model: res.model, attempts: attempt };
        firstError ??= parsed.error;
      }
      lastReason = firstError ? issues(firstError) : 'invalid';
    }
    messages = [
      ...messages,
      { role: 'assistant', content: lastRaw },
      { role: 'user', content: `Your reply did not match the required JSON format (${lastReason}). Reply again with exactly one corrected JSON object.` },
    ];
  }
  throw new LlmError(`structured output invalid twice: ${lastReason}`, {
    messageFa: fa.llm.badStructured,
    details: { role: opts.role, reason: lastReason, raw: redactText(lastRaw).slice(0, 2000) },
    retryable: true,
  });
}
