import type { SpawnedProcess, SpawnResult, Spawner } from '../cli.js';
import { fakeShell } from './console-mock.js';
import { MOCK_PLANS, type MockLiaraState } from './state.js';

/**
 * A `Spawner` that emulates the `liara` commands the agent uses, against `MockLiaraState`, so the real
 * `LiaraCli` wrapper runs unchanged in mock mode. Output shapes follow the T0.5 recordings where known
 * (plan:list, app:list, empty `db list`); others are best guesses marked in OPEN_QUESTIONS (OQ-16/17).
 */

const CLI_VERSION = '@liara/cli/9.6.0 mock node-v22';

interface Out {
  lines: string[];
  code: number;
  /** Extra async work before exit (e.g. waiting for a release). */
  after?: () => Promise<string[]>;
}

const err = (msg: string, code = 2): Out => ({ lines: [` »   Error: ${msg}`], code });

function flag(args: string[], ...names: string[]): string | undefined {
  for (const n of names) {
    const i = args.indexOf(n);
    if (i >= 0) return args[i + 1];
  }
  return undefined;
}

function stripAuth(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--api-token' || args[i] === '--team-id') {
      i++;
      continue;
    }
    out.push(args[i] as string);
  }
  return out;
}

export function createCliMock(state: MockLiaraState): Spawner {
  const run = (rawArgs: string[]): Out => {
    const args = stripAuth(rawArgs);
    const json = flag(args, '--output') === 'json';
    const [cmd, sub] = args;
    const appArg = flag(args, '-a', '--app');
    const appOf = () => (appArg ? state.apps.get(appArg) : undefined);

    if (cmd === '-v' || cmd === '--version') return { lines: [CLI_VERSION], code: 0 };
    if (cmd === 'plan:list') return { lines: [JSON.stringify(MOCK_PLANS)], code: 0 };
    if (cmd === 'app:list') {
      const rows = [...state.apps.values()].map((a) => ({ Name: a.name, Platform: a.platform, Plan: a.planID, 'Feature plan': 'standard', Scale: String(a.scale), Status: a.status, 'Created At': a.createdAt.slice(0, 10) }));
      return { lines: [json ? JSON.stringify(rows) : rows.map((r) => r.Name).join('\n')], code: 0 };
    }
    if (cmd === 'env:list') {
      const app = appOf();
      if (!app) return err('App not found.');
      return { lines: [JSON.stringify([...app.envs.entries()].map(([key, value]) => ({ key, value })))], code: 0 };
    }
    if (cmd === 'env:unset') {
      const app = appOf();
      if (!app) return err('App not found.');
      const keys = args.slice(1).filter((a, i, all) => !a.startsWith('-') && all[i] !== appArg);
      state.unsetEnvs(app, keys);
      return { lines: [`Unset ${keys.join(', ')}`], code: 0 };
    }
    if (cmd === 'logs') {
      const app = appOf();
      if (!app) return err('App not found.');
      return { lines: app.logs.map((l) => `${new Date(l.ts).toISOString()} ${l.message}`), code: 0 };
    }
    if (cmd === 'shell') {
      const app = appOf();
      if (!app) return err('App not found.');
      const r = fakeShell(state, app, flag(args, '-c', '--command') ?? '');
      return { lines: r.out ? r.out.split('\n') : [], code: r.code };
    }
    if (cmd === 'zone' && sub === 'check') {
      const zone = flag(args, '-z', '--zone') ?? '';
      return state.zones.has(zone) ? { lines: [`Zone ${zone} is active.`], code: 0 } : err(`NS records of ${zone} are not set to Liara.`, 1);
    }
    if (cmd === 'db') {
      const name = flag(args, '-n', '--name');
      const db = state.databases.find((d) => d.name === name);
      if (sub === 'list') {
        // recorded (T0.5): with no databases the CLI exits non-zero
        if (state.databases.length === 0) return { lines: [' »   Error: Not found any database.', ' »   Please open up https://console.liara.ir/databases and create the database,', ' »    first.'], code: 2 };
        return { lines: [JSON.stringify(state.databases.map((d) => ({ Name: d.name, Type: d.type, Plan: d.plan, Status: d.status })))], code: 0 };
      }
      if (sub === 'create') {
        if (!name) return err('name is required');
        if (db) return err('Database name already exists.');
        state.databases.push({ name, type: flag(args, '-t', '--type') ?? 'postgres', plan: flag(args, '--plan') ?? 'db-small', status: 'RUNNING' });
        return { lines: [`Database ${name} created.`], code: 0 };
      }
      if (!db) return err('Database not found.');
      if (sub === 'start') db.status = 'RUNNING';
      else if (sub === 'stop') db.status = 'STOPPED';
      else if (sub === 'resize') db.plan = flag(args, '--plan') ?? db.plan;
      else if (sub === 'remove') state.databases.splice(state.databases.indexOf(db), 1);
      else return err(`unknown db command ${sub ?? ''}`, 127);
      return { lines: [`Database ${name}: ${sub} done.`], code: 0 };
    }
    if (cmd === 'deploy') {
      const app = appOf();
      if (!app) return err('App not found.');
      const port = Number(flag(args, '--port') ?? 3000);
      const fault = state.nextDeployFault;
      state.nextDeployFault = undefined;
      if (fault === 'upload-error') return { lines: ['Compressing source...', 'Uploading source 37%', ' »   Error: socket hang up (ECONNRESET)'], code: 2 };
      const lines = ['Compressing source...', 'Uploading source 100%'];
      const sourceID = state.addSource(app, 1024);
      if (app.sources.get(sourceID)?.broken) {
        state.nextDeployFails = false;
        return { lines: [...lines, 'Building...', 'Step 1/3 : RUN npm run build', 'Build failed: npm run build exited with code 1'], code: 1 };
      }
      const scenario = fault && fault !== 'release-timeout' ? fault : undefined;
      const release = state.createRelease(app, { sourceID, port, type: flag(args, '--platform') ?? app.platform }, 'cli', scenario);
      lines.push('Building...', 'Step 1/3 : RUN npm ci', 'Pushing image...', 'Creating release...');
      if (args.includes('--detach')) return { lines: [...lines, `Release v${release.version} created (detached)`], code: 0 };
      // the release goes live, but the CLI never hears back
      if (fault === 'release-timeout') return { lines, code: 0, after: () => new Promise<string[]>(() => undefined) };
      return {
        lines,
        code: 0,
        after: async () => {
          await state.settle();
          return [`Release v${release.version} created`, 'Deployed successfully'];
        },
      };
    }
    return err(`command ${cmd ?? ''} not found`, 127);
  };

  return (file, args, opts): SpawnedProcess => {
    const real = file === 'npx' ? args.filter((a) => a !== '-y' && a !== '@liara/cli') : args;
    const out = run(real);
    let killed = false;
    let resolveResult!: (r: SpawnResult) => void;
    const result = new Promise<SpawnResult>((r) => (resolveResult = r));
    const all: string[] = [];
    let timedOut = false;
    const lines = (async function* () {
      for (const l of out.lines) {
        if (killed) break;
        all.push(l);
        yield l;
      }
      if (out.after && !killed) {
        let timer: NodeJS.Timeout | undefined;
        const expired = new Promise<string[]>((r) => {
          timer = setTimeout(() => {
            timedOut = true;
            r([]);
          }, opts.timeoutMs);
        });
        const more = await Promise.race([out.after(), expired]);
        clearTimeout(timer);
        for (const l of more) {
          all.push(l);
          yield l;
        }
      }
      resolveResult({ exitCode: killed || timedOut ? undefined : out.code, stdout: all.join('\n'), stderr: '', timedOut });
    })();
    return {
      lines,
      result,
      kill: () => {
        killed = true;
        resolveResult({ exitCode: undefined, stdout: all.join('\n'), stderr: '', timedOut: false });
      },
    };
  };
}
