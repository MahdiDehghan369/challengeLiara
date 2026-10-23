import { Command, Help, InvalidArgumentError } from 'commander';
import { stringify } from 'yaml';
import { readProjectState } from '../../agent/project-state.js';
import { createLiaraClient } from '../../liara/index.js';
import { redactObject, redactText } from '../../safety/redact.js';
import type { LogRecord } from '../../sre/logs.js';
import type { ToolResult } from '../../tools/types.js';
import { renderPlanCard, CANCELLED } from './approver.js';
import { formatError } from './errors.js';
import { renderMode, StepsView } from './render/steps.js';
import { fa } from './i18n/fa.js';
import { writeCredentials, type CliRuntime } from './runtime.js';

/**
 * CLI commands (T9.2) on commander. Every action goes through the Tool Registry (and so through the
 * Safety Gate); commands only collect arguments and print results. Help is Persian, sorted, and every
 * command shows an example.
 */

const c = fa.cmd;

export interface Globals {
  app?: string;
  dryRun?: boolean;
  verbose?: boolean;
  json?: boolean;
  yes?: boolean;
  /** `deploy --mode`. */
  mode?: 'cli' | 'api';
}

/** A command failed in a way already explained to the user (exit code 1, no stack). */
export class CliExit extends Error {
  constructor(readonly code = 1) {
    super(`exit ${code}`);
  }
}

// ---- parsing helpers ----------------------------------------------------------

export function parseDuration(s: string): number {
  const m = /^(\d+)\s*([smhd])?$/i.exec(s.trim());
  if (!m) throw new InvalidArgumentError(c.badDuration);
  const n = Number(m[1]);
  const unit = (m[2] ?? 's').toLowerCase();
  return n * (unit === 'm' ? 60 : unit === 'h' ? 3600 : unit === 'd' ? 86400 : 1);
}

export function parseOnOff(s: string): boolean {
  if (s === 'on') return true;
  if (s === 'off') return false;
  throw new InvalidArgumentError(c.badOnOff);
}

function parseMode(s: string): 'cli' | 'api' {
  if (s === 'cli' || s === 'api') return s;
  throw new InvalidArgumentError('cli | api');
}

function parsePositiveInt(s: string): number {
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) throw new InvalidArgumentError(c.badNumber);
  return n;
}

/** `KEY=VALUE` or `KEY` (value asked hidden later). */
export function parseEnvPair(s: string): { key: string; value?: string } {
  const i = s.indexOf('=');
  const key = i < 0 ? s : s.slice(0, i);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new InvalidArgumentError(c.badEnvPair(s));
  return i < 0 ? { key } : { key, value: s.slice(i + 1) };
}

// ---- help -----------------------------------------------------------------------

const TITLES: Array<[RegExp, string]> = [
  [/^Usage:/m, c.help.usage],
  [/^Arguments:$/m, c.help.args],
  [/^Options:$/m, c.help.options],
  [/^Commands:$/m, c.help.commands],
  [/^Global Options:$/m, c.help.global],
];

function persianHelp(cmd: Command): Command {
  cmd.configureHelp({
    sortSubcommands: true,
    sortOptions: true,
    showGlobalOptions: true,
    formatHelp: (command, helper) => TITLES.reduce((text, [re, title]) => text.replace(re, title), Help.prototype.formatHelp.call(helper, command, helper)),
  });
  cmd.helpOption('-h, --help', c.help.option);
  return cmd;
}

function sub(parent: Command, nameAndArgs: string, description: string, examples: string[]): Command {
  const cmd = persianHelp(parent.command(nameAndArgs).description(description));
  cmd.helpCommand(false);
  cmd.addHelpText('after', `\n${c.help.examples}\n${examples.map((e) => `  ${e}`).join('\n')}`);
  return cmd;
}

// ---- running tools ----------------------------------------------------------------

function globalsOf(cmd: Command): Globals {
  return cmd.optsWithGlobals<Globals>();
}

export async function invoke(rt: CliRuntime, g: Globals, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const s = await rt.services({ ...(g.yes ? { yes: true } : {}), ...(g.mode ? { deployMode: g.mode } : {}) });
  const r: ToolResult = await s.registry.invoke(tool, args, {
    liara: s.liara,
    llm: s.llm,
    approver: rt.approver(g.yes ? { yes: true } : {}),
    audit: s.audit,
    policy: s.policy,
    actor: 'user',
    ...(g.dryRun ? { dryRun: true } : {}),
  });
  if (!r.ok) {
    rt.err(`${c.failed}: ${r.error.messageFa}`);
    if (g.verbose) rt.err(r.error.message);
    throw new CliExit(1);
  }
  if (r.status === 'dry-run') {
    rt.out(g.json ? JSON.stringify({ dryRun: true, plan: redactObject(r.plan) }, null, 2) : `${c.dryRunTitle}\n${renderPlanCard(r.plan, { color: false })}`);
    return undefined;
  }
  if (r.status === 'pending') {
    rt.out(c.pending);
    return undefined;
  }
  return r.result;
}

export function print(rt: CliRuntime, g: Globals, value: unknown): void {
  if (value === undefined) return;
  const safe = redactObject(value);
  rt.out(g.json ? JSON.stringify(safe, null, 2) : redactText(stringify(safe, { lineWidth: 0 }).trimEnd()));
}

async function appOf(rt: CliRuntime, g: Globals, positional?: string): Promise<string> {
  const named = positional ?? g.app ?? readProjectState(rt.cwd)?.app;
  if (named) return named;
  const apps = (await invoke(rt, { ...g, dryRun: false }, 'list_apps', {})) as Array<{ name: string }> | undefined;
  const names = (apps ?? []).map((a) => a.name);
  if (names.length === 0) {
    rt.err(c.noApp);
    throw new CliExit(1);
  }
  const pick = await rt.ui.select(c.pickApp, names.map((n) => ({ value: n, label: n })));
  if (pick === CANCELLED) throw new CliExit(1);
  return pick;
}

const run =
  <A extends unknown[]>(rt: CliRuntime, fn: (...a: A) => Promise<void>) =>
  async (...a: A): Promise<void> => {
    await fn(...a);
  };

const logLine = (x: Pick<LogRecord, 'ts' | 'level' | 'text'>) => redactText(`${new Date(x.ts).toISOString()} [${x.level}] ${x.text}`);

// ---- program -----------------------------------------------------------------------

export interface ProgramOptions {
  version?: string;
  /** `siavash` without a command (T9.6). */
  chat?: (g: Globals) => Promise<void>;
  /** `siavash mcp` (T9.8). */
  mcp?: (g: Globals) => Promise<void>;
  /** Log follow polling (ms). */
  followIntervalMs?: number;
  /** Stops `logs -f` (tests); Ctrl+C otherwise. */
  followSignal?: AbortSignal;
}

export function buildProgram(rt: CliRuntime, opts: ProgramOptions = {}): Command {
  const program = persianHelp(new Command('siavash'));
  program
    .description(c.program)
    .version(opts.version ?? '0.1.0', '-V, --version', c.help.version)
    .helpCommand('help [command]', c.help.command)
    .option('-a, --app <name>', c.opt.app)
    .option('--dry-run', c.opt.dryRun)
    .option('--verbose', c.opt.verbose)
    .option('--json', c.opt.json)
    .option('-y, --yes', c.opt.yes)
    .configureOutput({ writeOut: (s) => rt.out(s.trimEnd()), writeErr: (s) => rt.err(s.trimEnd()) })
    .exitOverride()
    .action(
      run(rt, async () => {
        const g = globalsOf(program);
        if (opts.chat) await opts.chat(g);
        else rt.out(c.chatNotYet);
      }),
    );

  // login
  sub(program, 'login', c.login, ['siavash login']).action(
    run(rt, async () => {
      if (!rt.ui.password) {
        rt.err(c.noHiddenInput);
        throw new CliExit(1);
      }
      const token = await rt.ui.password(c.tokenPrompt);
      if (token === CANCELLED || !token.trim()) throw new CliExit(1);
      const team = await rt.ui.text(c.teamPrompt);
      const teamId = team === CANCELLED || !team.trim() ? undefined : team.trim();
      const s = await rt.services();
      // validate with a read-only call before anything is stored
      const probeClient = createLiaraClient({ liara: { token: token.trim(), teamId, mode: s.config.liara.mode }, dataDir: s.config.dataDir }, s.liara.mock ? { mockState: s.liara.mock.state } : {});
      try {
        await probeClient.apps.listApps({ fresh: true });
      } catch {
        rt.err(c.loginBad);
        throw new CliExit(1);
      }
      writeCredentials(rt.credentialsPath, { token: token.trim(), ...(teamId ? { teamId } : {}) });
      rt.out(c.loginOk(rt.credentialsPath));
    }),
  );

  // deploy / redeploy
  sub(program, 'deploy [path]', c.deploy, ['siavash deploy .', 'siavash deploy ./my-app --dry-run', 'siavash deploy --resume'])
    .option('--resume', c.opt.resume)
    .option('--mode <mode>', c.opt.mode, parseMode)
    .action(
      run(rt, async (path: string | undefined, o: { resume?: boolean }, cmd: Command) => {
        const g = globalsOf(cmd);
        if (o.resume) {
          // TODO(T5.1 session wiring): the pipeline can resume from a session checkpoint; the CLI does not keep sessions yet
          rt.out(c.notYet('--resume'));
          return;
        }
        print(rt, g, summarize(await withSteps(rt, g, () => invoke(rt, g, 'deploy_project', { path: path ?? '.' }))));
      }),
    );
  sub(program, 'redeploy [path]', c.redeploy, ['siavash redeploy', 'siavash redeploy ./my-app --app shop']).action(
    run(rt, async (path: string | undefined, _o: unknown, cmd: Command) => {
      const g = globalsOf(cmd);
      print(rt, g, summarize(await withSteps(rt, g, () => invoke(rt, g, 'redeploy_app', { path: path ?? '.', ...(g.app ? { app: g.app } : {}) }))));
    }),
  );

  // observe
  sub(program, 'status [app]', c.status, ['siavash status', 'siavash status shop --json']).action(
    run(rt, async (app: string | undefined, _o: unknown, cmd: Command) => {
      const g = globalsOf(cmd);
      print(rt, g, await invoke(rt, g, 'app_overview', { app: await appOf(rt, g, app) }));
    }),
  );
  sub(program, 'logs [app]', c.logs, ['siavash logs shop --since 1h', 'siavash logs -f'])
    .option('-f, --follow', c.opt.follow)
    .option('--since <duration>', c.opt.since, parseDuration)
    .action(
      run(rt, async (app: string | undefined, o: { follow?: boolean; since?: number }, cmd: Command) => {
        const g = globalsOf(cmd);
        const name = await appOf(rt, g, app);
        const fetchLogs = async (windowSec: number) => ((await invoke(rt, g, 'get_logs', { app: name, windowSec: Math.max(60, windowSec), limit: 100 })) as { recs: LogRecord[] }).recs;
        let recs = await fetchLogs(o.since ?? 900);
        if (g.json) print(rt, g, recs);
        else for (const x of recs) rt.out(logLine(x));
        let last = recs[recs.length - 1]?.ts ?? 0;
        while (o.follow && !opts.followSignal?.aborted) {
          await new Promise((r) => setTimeout(r, opts.followIntervalMs ?? 3000));
          recs = (await fetchLogs(120)).filter((x) => x.ts > last);
          for (const x of recs) rt.out(g.json ? JSON.stringify(redactObject(x)) : logLine(x));
          last = recs[recs.length - 1]?.ts ?? last;
        }
      }),
    );
  sub(program, 'events [app]', c.events, ['siavash events shop']).action(
    run(rt, async (app: string | undefined, _o: unknown, cmd: Command) => {
      const g = globalsOf(cmd);
      const evs = (await invoke(rt, g, 'get_events', { app: await appOf(rt, g, app) })) as Array<{ ts?: number; kind: string; message: string }>;
      if (g.json) print(rt, g, evs);
      else for (const e of evs) rt.out(redactText(`${e.ts ? new Date(e.ts).toISOString() : '-'} ${e.kind} ${e.message}`));
    }),
  );
  sub(program, 'doctor [app]', c.doctor, ['siavash doctor shop', 'siavash doctor --describe "the site is slow since this morning"'])
    .option('--describe <text>', c.opt.describe)
    .action(
      run(rt, async (app: string | undefined, o: { describe?: string }, cmd: Command) => {
        const g = globalsOf(cmd);
        const name = await appOf(rt, g, app);
        const diag = (await invoke(rt, { ...g, dryRun: false }, 'diagnose_app', { app: name, ...(o.describe ? { description: o.describe } : {}) })) as { healthy?: boolean; remediation?: { quickFix?: unknown; rootFix?: unknown } } | undefined;
        if (!diag || diag.healthy || g.dryRun || (!diag.remediation?.quickFix && !diag.remediation?.rootFix)) return;
        const choice = await rt.ui.select(c.doctorChoose, [
          ...(diag.remediation.rootFix ? [{ value: 'root' as const, label: c.doctorRoot }] : []),
          ...(diag.remediation.quickFix ? [{ value: 'quick' as const, label: c.doctorQuick }] : []),
          { value: 'skip' as const, label: c.doctorSkip },
        ]);
        if (choice === CANCELLED || choice === 'skip') return;
        const fixed = (await invoke(rt, g, 'fix_issue', { app: name, choice })) as { verification?: { verdictFa?: string }; reportFiles?: { markdown?: string } } | undefined;
        if (fixed?.verification?.verdictFa) rt.out(fixed.verification.verdictFa);
        if (fixed?.reportFiles?.markdown) rt.out(fixed.reportFiles.markdown);
      }),
    );
  sub(program, 'watch [app]', c.watch, ['siavash watch shop --interval 30 --duration 10'])
    .option('--interval <sec>', c.opt.interval, parsePositiveInt)
    .option('--duration <min>', c.opt.duration, parsePositiveInt)
    .action(run(rt, async () => rt.out(c.notYet('T7.7 / T9.7'))));

  // env
  const env = sub(program, 'env', c.env, ['siavash env list shop', 'siavash env set DATABASE_URL --app shop', 'siavash env unset OLD_KEY --app shop']);
  sub(env, 'list [app]', c.envList, ['siavash env list shop']).action(
    run(rt, async (app: string | undefined, _o: unknown, cmd: Command) => {
      const g = globalsOf(cmd);
      const vars = (await invoke(rt, g, 'list_env', { app: await appOf(rt, g, app) })) as Array<{ key: string; masked: string }>;
      if (g.json) print(rt, g, vars);
      else for (const v of vars) rt.out(`${v.key}=${v.masked}`);
    }),
  );
  sub(env, 'set <pairs...>', c.envSet, ['siavash env set NODE_ENV=production --app shop', 'siavash env set DATABASE_URL --app shop']).action(
    run(rt, async (pairs: string[], _o: unknown, cmd: Command) => {
      const g = globalsOf(cmd);
      const app = await appOf(rt, g);
      const vars: Record<string, string> = {};
      for (const p of pairs.map(parseEnvPair)) {
        if (p.value !== undefined) {
          vars[p.key] = p.value;
          continue;
        }
        if (!rt.ui.password) {
          rt.err(c.noHiddenInput);
          throw new CliExit(1);
        }
        const v = await rt.ui.password(c.envValue(p.key));
        if (v === CANCELLED) throw new CliExit(1);
        vars[p.key] = v;
      }
      print(rt, g, await invoke(rt, g, 'set_env', { app, vars }));
    }),
  );
  sub(env, 'unset <keys...>', c.envUnset, ['siavash env unset OLD_KEY --app shop']).action(
    run(rt, async (keys: string[], _o: unknown, cmd: Command) => {
      const g = globalsOf(cmd);
      print(rt, g, await invoke(rt, g, 'unset_env', { app: await appOf(rt, g), keys }));
    }),
  );

  // service
  for (const [name, tool, desc] of [
    ['restart', 'restart_app', c.restart],
    ['start', 'start_app', c.start],
    ['stop', 'stop_app', c.stop],
  ] as const) {
    sub(program, `${name} [app]`, desc, [`siavash ${name} shop`]).action(
      run(rt, async (app: string | undefined, _o: unknown, cmd: Command) => {
        const g = globalsOf(cmd);
        print(rt, g, await invoke(rt, g, tool, { app: await appOf(rt, g, app) }));
      }),
    );
  }
  sub(program, 'resize [app]', c.resize, ['siavash resize shop --plan medium-g2'])
    .requiredOption('--plan <id>', c.opt.plan)
    .action(
      run(rt, async (app: string | undefined, o: { plan: string }, cmd: Command) => {
        const g = globalsOf(cmd);
        print(rt, g, await invoke(rt, g, 'resize_app', { app: await appOf(rt, g, app), planID: o.plan }));
      }),
    );
  sub(program, 'rollback [app]', c.rollback, ['siavash rollback shop', 'siavash rollback shop --to <deployment-id>'])
    .option('--to <id>', c.opt.to)
    .action(
      run(rt, async (app: string | undefined, o: { to?: string }, cmd: Command) => {
        const g = globalsOf(cmd);
        print(rt, g, await invoke(rt, g, 'rollback_app', { app: await appOf(rt, g, app), ...(o.to ? { targetId: o.to } : {}) }));
      }),
    );
  const SETTING_TOOL: Record<string, string> = { 'zero-downtime': 'set_zero_downtime', subdomain: 'set_default_subdomain', 'fixed-ip': 'set_fixed_ip', 'read-only': 'set_read_only' };
  sub(program, 'settings <setting> <state>', c.settings, ['siavash settings zero-downtime on --app shop', 'siavash settings read-only off --app shop']).action(
    run(rt, async (setting: string, state: string, _o: unknown, cmd: Command) => {
      const g = globalsOf(cmd);
      const tool = SETTING_TOOL[setting];
      if (!tool) throw new InvalidArgumentError(Object.keys(SETTING_TOOL).join(' | '));
      print(rt, g, await invoke(rt, g, tool, { app: await appOf(rt, g), on: parseOnOff(state) }));
    }),
  );

  // domains, disks, backups, databases
  const domain = sub(program, 'domain', c.domain, ['siavash domain list shop']);
  sub(domain, 'list [app]', c.domainList, ['siavash domain list shop']).action(
    run(rt, async (app: string | undefined, _o: unknown, cmd: Command) => {
      const g = globalsOf(cmd);
      print(rt, g, await invoke(rt, g, 'list_domains', { app: await appOf(rt, g, app) }));
    }),
  );
  for (const n of ['add', 'ssl', 'redirect']) sub(domain, `${n} [args...]`, c.domain, [`siavash domain ${n} --help`]).action(run(rt, async () => rt.out(c.notYet('T5.9 / T6.x'))));

  const disk = sub(program, 'disk', c.disk, ['siavash disk list shop']);
  sub(disk, 'list [app]', c.diskList, ['siavash disk list shop']).action(
    run(rt, async (app: string | undefined, _o: unknown, cmd: Command) => {
      const g = globalsOf(cmd);
      print(rt, g, await invoke(rt, g, 'list_disks', { app: await appOf(rt, g, app) }));
    }),
  );
  sub(disk, 'create <name>', c.diskCreate, ['siavash disk create data --size 5 --app shop'])
    .requiredOption('--size <gb>', c.opt.size, parsePositiveInt)
    .action(
      run(rt, async (name: string, o: { size: number }, cmd: Command) => {
        const g = globalsOf(cmd);
        print(rt, g, await invoke(rt, g, 'create_disk', { app: await appOf(rt, g), name, sizeGb: o.size }));
      }),
    );
  sub(disk, 'resize <name>', c.diskResize, ['siavash disk resize data --size 10 --app shop'])
    .requiredOption('--size <gb>', c.opt.size, parsePositiveInt)
    .action(
      run(rt, async (name: string, o: { size: number }, cmd: Command) => {
        const g = globalsOf(cmd);
        print(rt, g, await invoke(rt, g, 'resize_disk', { app: await appOf(rt, g), disk: name, sizeGb: o.size }));
      }),
    );

  const backup = sub(program, 'backup', c.backup, ['siavash backup list --disk data --app shop']);
  sub(backup, 'create', c.backupCreate, ['siavash backup create --disk data --app shop'])
    .requiredOption('--disk <name>', c.opt.disk)
    .action(
      run(rt, async (o: { disk: string }, cmd: Command) => {
        const g = globalsOf(cmd);
        print(rt, g, await invoke(rt, g, 'create_backup', { app: await appOf(rt, g), disk: o.disk }));
      }),
    );
  sub(backup, 'list', c.backupList, ['siavash backup list --disk data --app shop'])
    .requiredOption('--disk <name>', c.opt.disk)
    .action(
      run(rt, async (o: { disk: string }, cmd: Command) => {
        const g = globalsOf(cmd);
        print(rt, g, await invoke(rt, g, 'list_backups', { app: await appOf(rt, g), disk: o.disk }));
      }),
    );
  sub(backup, 'download <backup>', c.backupDownload, ['siavash backup download <backup-name> --disk data --app shop'])
    .requiredOption('--disk <name>', c.opt.disk)
    .action(
      run(rt, async (name: string, o: { disk: string }, cmd: Command) => {
        const g = globalsOf(cmd);
        const link = (await invoke(rt, g, 'backup_download_link', { app: await appOf(rt, g), disk: o.disk, backup: name })) as { reveal(): string } | undefined;
        if (!link) return;
        // the user asked for the link itself: shown once, never logged
        rt.out(c.secretLinkWarn);
        rt.out(link.reveal());
      }),
    );

  const db = sub(program, 'db', c.db, ['siavash db list']);
  sub(db, 'list', c.dbList, ['siavash db list']).action(
    run(rt, async (_o: unknown, cmd: Command) => {
      const g = globalsOf(cmd);
      print(rt, g, await invoke(rt, g, 'list_databases', {}));
    }),
  );
  sub(db, 'create [args...]', c.dbCreate, ['siavash deploy .']).action(run(rt, async () => rt.out(c.notYet('T6.x'))));

  // history and the rest
  sub(program, 'deployments [app]', c.deployments, ['siavash deployments shop']).action(
    run(rt, async (app: string | undefined, _o: unknown, cmd: Command) => {
      const g = globalsOf(cmd);
      print(rt, g, await invoke(rt, g, 'list_deployments', { app: await appOf(rt, g, app) }));
    }),
  );
  sub(program, 'limits', c.limits, ['siavash limits']).action(
    run(rt, async (_o: unknown, cmd: Command) => {
      const g = globalsOf(cmd);
      print(rt, g, await invoke(rt, g, 'get_limits', {}));
    }),
  );
  const runbook = sub(program, 'runbook', c.runbook, ['siavash runbook list']);
  for (const n of ['list', 'run [name]']) sub(runbook, n, c.runbook, [`siavash runbook ${n.split(' ')[0]}`]).action(run(rt, async () => rt.out(c.notYet('T10.x'))));
  sub(program, 'schedule', c.schedule, ['siavash schedule']).action(run(rt, async () => rt.out(c.notYet('T10.x'))));
  sub(program, 'history', c.history, ['siavash history', 'siavash history --undo'])
    .option('--undo', c.opt.undo)
    .action(run(rt, async () => rt.out(c.notYet('T2.x'))));
  sub(program, 'mcp', c.mcp, ['siavash mcp']).action(
    run(rt, async (_o: unknown, cmd: Command) => {
      if (opts.mcp) await opts.mcp(globalsOf(cmd));
      else rt.out(c.notYet('T9.8'));
    }),
  );
  return program;
}

/** Runs a pipeline tool with the live step checklist attached (T9.3). */
async function withSteps(rt: CliRuntime, g: Globals, fn: () => Promise<unknown>): Promise<unknown> {
  const s = await rt.services({ ...(g.yes ? { yes: true } : {}), ...(g.mode ? { deployMode: g.mode } : {}) });
  const view = new StepsView({ mode: renderMode({ ...(g.json ? { json: true } : {}), isTTY: rt.isTTY }), write: (t) => rt.out(t) });
  s.pipelineEvents.sink = (e) => view.handle(e);
  try {
    return await fn();
  } finally {
    view.stop();
    delete s.pipelineEvents.sink;
  }
}

/** Pipeline results: the summary card data, not the whole state. */
function summarize(r: unknown): unknown {
  if (!r || typeof r !== 'object' || !('state' in r)) return r;
  const p = r as { status: string; failedStep?: string; messageFa?: string; state: { summary?: unknown; appName?: string } };
  return { status: p.status, ...(p.failedStep ? { failedStep: p.failedStep } : {}), ...(p.messageFa ? { messageFa: p.messageFa } : {}), app: p.state.appName, summary: p.state.summary };
}

/** Runs the CLI; returns the exit code (never throws). */
export async function runCli(rt: CliRuntime, argv: string[], opts: ProgramOptions = {}): Promise<number> {
  const program = buildProgram(rt, opts);
  try {
    await program.parseAsync(argv, { from: 'user' });
    return 0;
  } catch (e) {
    if (e instanceof CliExit) return e.code;
    const ce = e as { code?: string; exitCode?: number };
    // help / version are "errors" for commander with exitOverride
    if (ce.code === 'commander.helpDisplayed' || ce.code === 'commander.version' || ce.code === 'commander.help') return 0;
    if (typeof ce.code === 'string' && ce.code.startsWith('commander.')) return ce.exitCode ?? 1;
    rt.err(formatError(e, { verbose: program.opts<Globals>().verbose === true }));
    return 1;
  }
}
