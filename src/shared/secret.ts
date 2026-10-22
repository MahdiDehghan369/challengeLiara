import { inspect } from 'node:util';

export const SECRET_PLACEHOLDER = '[SECRET]';

/**
 * Wraps a sensitive value (passwords, env values, signed links). Every implicit serialization
 * — string coercion, JSON.stringify, util.inspect / console.log, pino — yields `[SECRET]`.
 * Only `reveal()` returns the value; call it solely where the value must leave the process
 * (an outgoing API body) or be shown deliberately in the UI.
 */
export class Secret<T = string> {
  readonly #value: T;

  constructor(value: T) {
    this.#value = value;
  }

  reveal(): T {
    return this.#value;
  }

  toString(): string {
    return SECRET_PLACEHOLDER;
  }

  toJSON(): string {
    return SECRET_PLACEHOLDER;
  }

  [inspect.custom](): string {
    return SECRET_PLACEHOLDER;
  }

  [Symbol.toPrimitive](): string {
    return SECRET_PLACEHOLDER;
  }
}

export function secret<T>(value: T): Secret<T> {
  return new Secret(value);
}

export function isSecret(v: unknown): v is Secret<unknown> {
  return v instanceof Secret;
}

/** Masked preview for confirmations, e.g. "post••••(18)". Never shows more than 4 leading chars. */
export function maskSecret(s: Secret<string>, visible = 4): string {
  const v = s.reveal();
  if (v.length <= visible * 2) return '•'.repeat(Math.max(4, v.length));
  return `${v.slice(0, visible)}••••(${v.length})`;
}
