import * as dnsPromises from 'node:dns/promises';
import { ExternalCommandError } from '../shared/errors.js';
import type { LiaraCli } from './cli.js';

/** The subset of `node:dns/promises` used here (injectable for tests). */
export interface DnsResolver {
  resolveCname(hostname: string): Promise<string[]>;
  resolve4(hostname: string): Promise<string[]>;
}

const NO_RECORD = new Set(['ENODATA', 'ENOTFOUND', 'ESERVFAIL', 'NXDOMAIN', 'ENOTIMP', 'EREFUSED']);

function normalize(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

async function safe(fn: () => Promise<string[]>): Promise<string[]> {
  try {
    return (await fn()).map(normalize);
  } catch (e) {
    if (NO_RECORD.has((e as NodeJS.ErrnoException).code ?? '')) return [];
    throw e;
  }
}

/** CNAME targets of `domain` (normalized; [] when there is no record). */
export function resolveCname(domain: string, resolver: DnsResolver = dnsPromises): Promise<string[]> {
  return safe(() => resolver.resolveCname(normalize(domain)));
}

/** A records of `domain` ([] when there is none). */
export function resolveA(domain: string, resolver: DnsResolver = dnsPromises): Promise<string[]> {
  return safe(() => resolver.resolve4(normalize(domain)));
}

export interface DnsExpectation {
  /** Liara's `CNameRecord` for the domain. */
  cname?: string;
  /** Expected A record(s), e.g. a fixed IP. Any one present counts. */
  a?: string[];
}

export interface DnsMatchResult {
  matches: boolean;
  actual: { cname: string[]; a: string[] };
}

/** Compares live DNS with what Liara expects (CNAME and/or A). Both given → either matching is enough. */
export async function dnsMatches(
  domain: string,
  expected: DnsExpectation,
  resolver: DnsResolver = dnsPromises,
): Promise<DnsMatchResult> {
  const [cname, a] = await Promise.all([resolveCname(domain, resolver), resolveA(domain, resolver)]);
  const cnameOk = expected.cname !== undefined && cname.includes(normalize(expected.cname));
  const aOk = expected.a !== undefined && expected.a.some((ip) => a.includes(ip.trim()));
  return { matches: cnameOk || aOk, actual: { cname, a } };
}

/** `liara zone check -z <domain>` for users on Liara DNS. Non-zero exit → `ok: false` with the output tail. */
export async function zoneCheck(
  cli: Pick<LiaraCli, 'zoneCheck'>,
  domain: string,
): Promise<{ ok: boolean; output: string }> {
  try {
    const r = await cli.zoneCheck(normalize(domain));
    return { ok: true, output: r.stdout };
  } catch (e) {
    if (e instanceof ExternalCommandError) {
      const tail = (e.details as { tail?: string[] } | undefined)?.tail ?? [];
      return { ok: false, output: tail.join('\n') };
    }
    throw e;
  }
}
