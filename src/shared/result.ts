import type { SiavashError } from './errors.js';

export type Ok<T> = { ok: true; data: T };
export type Err<E = SiavashError> = { ok: false; error: E };
export type Result<T, E = SiavashError> = Ok<T> | Err<E>;

export function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}

export function err<E = SiavashError>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return !r.ok;
}
