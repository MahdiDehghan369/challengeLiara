/** Internal platform names produced by the analyzer (01-ANALYSIS §5.1). */
export const PLATFORMS = [
  'docker',
  'next',
  'react-static',
  'node',
  'django',
  'flask',
  'fastapi',
  'laravel',
  'go',
  'static',
  'unknown',
] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface LiaraPlatformInfo {
  /** Value for `platform` in createApp and `type` in createRelease / `--platform` in the CLI. */
  liaraId: string | undefined;
  /** Where the id comes from. Unconfirmed ids stay undefined (never guessed). */
  source: 'liara-cli-docs' | 'tasks-doc-unverified' | 'unknown';
}

/**
 * Internal platform → Liara platform id.
 * TODO(OQ-20): only `docker` and `next` appear in Liara's docs (`--platform=docker`, `liara init -P next`).
 * `node` is used by 03-TASKS T0.8 (`type:"node"`) but not yet verified. Record the full list in T0.5
 * (`liara create --help`) / T0.8 and fill the rest here.
 */
export const PLATFORM_MAP: Record<Platform, LiaraPlatformInfo> = {
  docker: { liaraId: 'docker', source: 'liara-cli-docs' },
  next: { liaraId: 'next', source: 'liara-cli-docs' },
  node: { liaraId: 'node', source: 'tasks-doc-unverified' },
  'react-static': { liaraId: undefined, source: 'unknown' },
  django: { liaraId: undefined, source: 'unknown' },
  flask: { liaraId: undefined, source: 'unknown' },
  fastapi: { liaraId: undefined, source: 'unknown' },
  laravel: { liaraId: undefined, source: 'unknown' },
  go: { liaraId: undefined, source: 'unknown' },
  static: { liaraId: undefined, source: 'unknown' },
  unknown: { liaraId: undefined, source: 'unknown' },
};

export function liaraPlatformId(p: Platform): string | undefined {
  return PLATFORM_MAP[p].liaraId;
}
