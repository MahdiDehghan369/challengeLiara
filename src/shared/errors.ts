import { fa } from '../ui/cli/i18n/fa.js';

export interface ErrorOptions {
  /** Persian, user-facing message. Falls back to a generic message per class. */
  messageFa?: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
  cause?: unknown;
}

/** Base class for every error this project throws or returns (AGENT_RULES §2). */
export abstract class SiavashError extends Error {
  abstract readonly code: string;
  readonly messageFa: string;
  readonly details: Record<string, unknown>;
  readonly retryable: boolean;

  protected constructor(message: string, defaultFa: string, opts: ErrorOptions = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = new.target.name;
    this.messageFa = opts.messageFa ?? defaultFa;
    this.details = opts.details ?? {};
    this.retryable = opts.retryable ?? false;
  }
}

export class LiaraApiError extends SiavashError {
  /** Defaults to LIARA_API_ERROR; specific cases use e.g. APP_NOT_FOUND, APP_NAME_TAKEN, TIMEOUT. */
  readonly code: string;
  readonly status: number | undefined;
  readonly operationId: string | undefined;

  constructor(
    message: string,
    opts: ErrorOptions & { status?: number; code?: string; operationId?: string } = {},
  ) {
    super(message, fa.errors.liaraApi, {
      ...opts,
      retryable: opts.retryable ?? (opts.status !== undefined && opts.status >= 500),
    });
    this.code = opts.code ?? 'LIARA_API_ERROR';
    this.status = opts.status;
    this.operationId = opts.operationId;
  }
}

export class ValidationError extends SiavashError {
  readonly code = 'VALIDATION_ERROR';

  constructor(message: string, opts: ErrorOptions = {}) {
    super(message, fa.errors.validation, opts);
  }
}

export class ApprovalDeniedError extends SiavashError {
  readonly code = 'APPROVAL_DENIED';

  constructor(message: string, opts: ErrorOptions = {}) {
    super(message, fa.errors.approvalDenied, opts);
  }
}

export class RateLimitError extends SiavashError {
  readonly code = 'RATE_LIMIT';
  readonly retryAfterMs: number | undefined;

  constructor(message: string, opts: ErrorOptions & { retryAfterMs?: number } = {}) {
    super(message, fa.errors.rateLimit, { ...opts, retryable: opts.retryable ?? true });
    this.retryAfterMs = opts.retryAfterMs;
  }
}

export class ExternalCommandError extends SiavashError {
  readonly code = 'EXTERNAL_COMMAND_ERROR';
  readonly exitCode: number | undefined;

  constructor(message: string, opts: ErrorOptions & { exitCode?: number } = {}) {
    super(message, fa.errors.externalCommand, opts);
    this.exitCode = opts.exitCode;
  }
}

export class LlmError extends SiavashError {
  readonly code = 'LLM_ERROR';

  constructor(message: string, opts: ErrorOptions = {}) {
    super(message, fa.errors.llm, opts);
  }
}

export function isSiavashError(e: unknown): e is SiavashError {
  return e instanceof SiavashError;
}
