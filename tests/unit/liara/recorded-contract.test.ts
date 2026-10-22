import { describe, expect, it } from 'vitest';
import { ProjectsResponseSchema } from '../../../src/liara/api/schemas/apps.js';
import { LiaraCli, type SpawnResult, type Spawner } from '../../../src/liara/cli.js';
import { ExternalCommandError } from '../../../src/shared/errors.js';
import { loadRecorded } from '../../helpers/fixtures.js';

/** Contract tests: our schemas against real (redacted) Liara responses recorded in T0.5. */

describe('recorded: GET /v1/projects', () => {
  it('parses with ProjectsResponseSchema (status ACTIVE, scale number, bundlePlanID, network)', () => {
    const raw = loadRecorded<{ projects: Array<Record<string, unknown>> }>('projects.list.json');
    const parsed = ProjectsResponseSchema.parse(raw);
    expect(parsed.projects.length).toBe(raw.projects.length);
    expect(raw.projects[0]).toMatchObject({ status: 'ACTIVE', isDeployed: true });
    expect(typeof raw.projects[0]?._id).toBe('string');
  });
});

describe('recorded: GET /v1/billing (OQ-4)', () => {
  it('has user/team with balance, accountType, minCreditAmount, isManualMinCredit', () => {
    const b = loadRecorded<Record<string, Record<string, unknown>>>('billing.json');
    for (const who of ['user', 'team'] as const) {
      expect(typeof b[who]?.balance).toBe('number');
      expect(typeof b[who]?.accountType).toBe('string');
      expect(typeof b[who]?.minCreditAmount).toBe('number');
      expect(typeof b[who]?.isManualMinCredit).toBe('boolean');
    }
  });
});

describe('recorded: liara plan:list --output json (OQ-5)', () => {
  it('array of string-valued rows {Plan, RAM, CPU, Disk, Price, Free, Standard, Pro}; prices use thousands commas', () => {
    const plans = loadRecorded<Array<Record<string, string>>>('cli.plan-list.json');
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) {
      expect(Object.keys(p).sort()).toEqual(['CPU', 'Disk', 'Free', 'Plan', 'Price', 'Pro', 'RAM', 'Standard']);
      expect(Object.values(p).every((v) => typeof v === 'string')).toBe(true);
    }
    expect(plans.some((p) => p.Price?.includes(','))).toBe(true);
  });
});

describe('recorded: liara db list with no databases', () => {
  const spawner =
    (lines: string[], exitCode: number): Spawner =>
    () => ({
      lines: (async function* () {
        for (const l of lines) yield l;
      })(),
      result: Promise.resolve({ exitCode, stdout: lines.join('\n'), stderr: '', timedOut: false } satisfies SpawnResult),
      kill: () => {},
    });

  it('the recorded "Not found any database." exit is treated as an empty list', async () => {
    const rec = loadRecorded<{ details: { tail: string[] } }>('cli.db-list.error.json');
    const cli = new LiaraCli({ token: 'tok-123456789', spawner: spawner(rec.details.tail, 2) });
    expect(await cli.dbList()).toEqual([]);
  });

  it('other db list failures still throw', async () => {
    const cli = new LiaraCli({ token: 'tok-123456789', spawner: spawner(['Error: unauthorized'], 2) });
    await expect(cli.dbList()).rejects.toBeInstanceOf(ExternalCommandError);
  });
});
