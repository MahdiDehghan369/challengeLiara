import { redactText } from '../../safety/redact.js';
import {
  ApprovalDeniedError,
  BudgetExceededError,
  ExternalCommandError,
  LiaraApiError,
  RateLimitError,
  ValidationError,
  isSiavashError,
} from '../../shared/errors.js';
import { formatFaDuration } from '../../shared/time.js';
import { fa } from './i18n/fa.js';

/**
 * User-facing errors (T9.9): "what happened" + "what to do", plus technical details only with
 * `--verbose`. Raw stack traces never reach the user otherwise. Everything is redacted.
 */

export interface FriendlyError {
  code: string;
  whatFa: string;
  doFa: string;
  /** A command to run (LTR; printed on its own line). */
  command?: string;
  /** `name: message`, code, details — redacted. */
  technical: string;
  stack?: string;
}

const f = fa.friendly;

function technicalOf(err: unknown): { technical: string; stack?: string } {
  if (err instanceof Error) {
    const parts = [`${err.name}: ${err.message}`];
    if (isSiavashError(err)) {
      parts.push(`code=${err.code}`);
      if (Object.keys(err.details).length) parts.push(`details=${safeJson(err.details)}`);
    }
    return { technical: redactText(parts.join('\n')), ...(err.stack ? { stack: redactText(err.stack) } : {}) };
  }
  return { technical: redactText(String(err)) };
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return '[unserializable]';
  }
}

function isCliMissing(err: unknown): boolean {
  if (!(err instanceof ExternalCommandError)) return false;
  if (err.details.cliMissing === true) return true;
  const cause = (err as { cause?: { code?: string } }).cause;
  return cause?.code === 'ENOENT' || /ENOENT|not recognized as an internal|command not found/i.test(err.message);
}

function isLowBalance(err: unknown): boolean {
  if (!(err instanceof LiaraApiError)) return false;
  if (err.status === 402 || err.code === 'INSUFFICIENT_BALANCE') return true;
  const remote = typeof err.details.remote === 'string' ? err.details.remote : '';
  const text = `${err.message} ${remote}`;
  return /insufficient|balance|credit/i.test(text) || text.includes(f.balanceKeyword);
}

export function explainError(err: unknown): FriendlyError {
  const tech = technicalOf(err);
  const make = (code: string, whatFa: string, doFa: string, command?: string): FriendlyError => ({
    code,
    whatFa,
    doFa,
    ...(command ? { command } : {}),
    ...tech,
  });

  if (err instanceof ValidationError && (err.messageFa === fa.config.missingLiaraToken || err.messageFa === fa.config.missingBoxApiKey)) {
    const key = err.messageFa === fa.config.missingBoxApiKey ? 'BOXAPI_API_KEY' : 'LIARA_API_TOKEN';
    return make('CONFIG_MISSING_KEY', err.messageFa, f.envKeyDo(key));
  }
  if (err instanceof RateLimitError) {
    const wait = err.retryAfterMs !== undefined ? formatFaDuration(Math.max(1, Math.ceil(err.retryAfterMs / 1000))) : undefined;
    return make(err.code, err.messageFa, wait ? f.rateDo(wait) : f.rateDoUnknown);
  }
  if (isCliMissing(err)) return make('CLI_MISSING', f.cliMissingWhat, f.cliMissingDo, 'npm install -g @liara/cli');
  if (isLowBalance(err)) return make('INSUFFICIENT_BALANCE', f.balanceWhat, f.balanceDo);
  if (err instanceof LiaraApiError) {
    if (err.code === 'UNAUTHORIZED' || err.status === 401) return make('UNAUTHORIZED', fa.liaraHttp.unauthorized, f.tokenDo);
    if (err.code === 'NETWORK_ERROR' || err.code === 'TIMEOUT') return make(err.code, f.networkWhat, f.networkDo);
    if (err.code === 'APP_NOT_FOUND') {
      const suggestion = typeof err.details.suggestion === 'string' ? err.details.suggestion : undefined;
      return suggestion
        ? make(err.code, err.messageFa, f.notFoundSuggestDo(suggestion))
        : make(err.code, err.messageFa, f.notFoundDo, 'siavash apps');
    }
    if (err.status === 409 || ['APP_NAME_TAKEN', 'CONFLICT', 'DOMAIN_EXISTS'].includes(err.code)) {
      return make(err.code, err.messageFa, f.conflictDo);
    }
    if (err.code === 'WAIT_TIMEOUT' || err.code === 'DEPLOY_TIMEOUT') {
      const app = typeof err.details.app === 'string' ? err.details.app : '<app>';
      return make(err.code, f.timeoutWhat, f.timeoutDo, `siavash logs ${app}`);
    }
  }
  if (err instanceof ExternalCommandError && err.details.timedOut === true) {
    return make('COMMAND_TIMEOUT', f.timeoutWhat, f.timeoutDo, 'siavash status');
  }
  if (err instanceof ApprovalDeniedError) return make(err.code, err.messageFa, f.deniedDo);
  if (err instanceof BudgetExceededError) return make(err.code, err.messageFa, f.budgetDo);
  if (isSiavashError(err)) return make(err.code, err.messageFa, f.genericDo);
  return make('UNEXPECTED', f.unexpectedWhat, f.genericDo);
}

/** Renders the message for the terminal. Stack traces only with `verbose`. */
export function formatError(err: unknown, opts: { verbose?: boolean } = {}): string {
  const e = explainError(err);
  const lines = [`${f.whatLabel} ${e.whatFa}`, `${f.doLabel} ${e.doFa}`];
  // the command goes on its own line so the terminal does not reorder it inside RTL text
  if (e.command) lines.push(`  ${e.command}`);
  if (opts.verbose) {
    lines.push('', f.techLabel, e.technical);
    if (e.stack) lines.push(e.stack);
  } else {
    lines.push(f.verboseHint);
  }
  return lines.join('\n');
}
