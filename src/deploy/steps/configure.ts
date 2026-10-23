import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import type { LiaraClient } from '../../liara/index.js';
import type { OpsContext } from '../../ops/context.js';
import { setEnv } from '../../ops/env.js';
import { setZeroDowntime } from '../../ops/settings.js';
import { ApprovalDeniedError } from '../../shared/errors.js';
import { Secret } from '../../shared/secret.js';
import { CANCELLED, type Prompter } from '../../ui/cli/approver.js';
import { fa } from '../../ui/cli/i18n/fa.js';
import type { Step } from '../pipeline-engine.js';
import type { ProvisionState, SecretStore } from './provision.js';

/**
 * Configure (T5.6): collect env values (secrets via hidden input only) and apply them in one batch
 * through `set_env` (the gate raises secret names to R2); write `liara.json` after showing a diff;
 * create `.liaraignore` when missing; offer zero-downtime for production (R1).
 * Secret values never reach the terminal or the audit log: plans carry key names and fingerprints only.
 */

export const LIARAIGNORE_DEFAULT = ['node_modules', '.env', '.env.*', '.git', '.siavash', ''].join('\n');

export interface ConfigureState extends ProvisionState {
  configured?: {
    envKeys: string[];
    skippedEnv: string[];
    liaraJson: 'written' | 'unchanged' | 'skipped' | 'invalid';
    liaraignore: 'created' | 'exists';
    zeroDowntime?: boolean;
    /** TODO(OQ-21): absolute mount path unknown → disks are attached at deploy time once known. */
    diskMount: 'none' | 'set' | 'pending';
  };
}

export interface ConfigureDeps {
  liara: Pick<LiaraClient, 'env' | 'settings'>;
  ui: Prompter;
  ops: OpsContext;
  secrets: SecretStore;
  yes?: boolean;
  /** `--build-location` (iran | germany); omitted unless given. */
  buildLocation?: string;
  /** Absolute mount path for a project folder, once known (OQ-21). */
  mountPathFor?: (folder: string) => string | undefined;
}

type EnvValue = string | Secret<string>;

/** The `liara.json` fields this agent manages (T5.6); other keys in the file are preserved. */
export function desiredLiaraJson(s: ConfigureState, deps: Pick<ConfigureDeps, 'buildLocation' | 'mountPathFor'>): Record<string, unknown> {
  const r = s.report!;
  const out: Record<string, unknown> = { app: s.appName, port: r.port.port };
  if (r.platform.liaraPlatformId) out.platform = r.platform.liaraPlatformId;
  const disk = s.provisioned?.disk;
  if (disk && deps.mountPathFor) {
    // TODO(OQ-32): key names of a liara.json disk entry are not in our docs.
    const mounts = disk.folders.map((f) => deps.mountPathFor?.(f)).filter((m): m is string => !!m);
    if (mounts.length === disk.folders.length && mounts.length > 0) out.disks = mounts.map((m) => ({ name: disk.name, mountTo: m }));
  }
  if (deps.buildLocation) out.build = { location: deps.buildLocation };
  return out;
}

function stable(obj: Record<string, unknown>): string {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

export function configureStep<S extends ConfigureState>(deps: ConfigureDeps): Step<S> {
  const c = fa.configure;
  return {
    id: 'configure',
    titleFa: c.title,
    onFail: 'abort',
    run: async (ctx) => {
      const s = ctx.state;
      const { ui } = deps;
      const report = s.report;
      const app = s.appName;
      const path = s.projectPath;
      if (!report || !app || !path) throw new Error('configure needs the analyze step first');

      // 1) env values
      const vars: Record<string, EnvValue> = {};
      const skipped: string[] = [];
      const dbEnv = s.provisioned?.db?.envName;
      const candidates = report.env.filter((v) => !v.managedByAgent);
      if (candidates.length > 0) ui.note(c.envIntro(candidates.length), c.envTitle);
      for (const v of candidates) {
        const fromDb = v.name === dbEnv ? deps.secrets.get(v.name) : undefined;
        if (fromDb) {
          vars[v.name] = fromDb;
          ui.note(c.fromDatabase(v.name), c.envTitle);
          continue;
        }
        // --yes: optional ones are skipped, required ones with a safe suggestion take it; the rest must be asked
        if (deps.yes && !v.required) {
          skipped.push(v.name);
          continue;
        }
        if (deps.yes && v.suggestedValue !== undefined) {
          vars[v.name] = v.suggestedValue;
          continue;
        }
        if (v.isSecret) {
          if (!ui.password) {
            ui.note(c.noHiddenInput(v.name), c.envTitle);
            skipped.push(v.name);
            continue;
          }
          let value = await ui.password(c.askSecret(v.name, v.required));
          while (value !== CANCELLED && v.required && !value) {
            ui.note(c.requiredEmpty, c.envTitle);
            value = await ui.password(c.askSecret(v.name, v.required));
          }
          if (value === CANCELLED || !value) skipped.push(v.name);
          else vars[v.name] = new Secret(value);
        } else {
          const value = await ui.text(c.askValue(v.name, v.required), {
            ...(v.suggestedValue !== undefined ? { initialValue: v.suggestedValue } : {}),
            validate: (x) => (v.required && !x.trim() ? c.requiredEmpty : undefined),
          });
          if (value === CANCELLED || !value.trim()) skipped.push(v.name);
          else vars[v.name] = value.trim();
        }
      }
      // env vars the agent manages and the code reads
      for (const v of report.env.filter((x) => x.managedByAgent)) {
        if (v.name === 'PORT') vars.PORT = String(report.port.port);
        if (v.name === 'NODE_ENV' && ['node', 'next'].includes(report.platform.platform)) vars.NODE_ENV = 'production';
      }
      if (skipped.length > 0) ui.note(c.envSkipped(skipped.join(', ')), c.envTitle);
      if (Object.keys(vars).length > 0) {
        ctx.setStatus('waiting-approval');
        const res = await setEnv(deps.liara.env, app, vars, deps.ops);
        if (res.status !== 'executed' && res.status !== 'no-change') throw new Error(`set_env not executed (${res.status})`);
        ctx.setStatus('running');
      }

      // 2) liara.json (local file: diff + confirmation)
      const file = join(path, 'liara.json');
      let liaraJson: NonNullable<ConfigureState['configured']>['liaraJson'] = 'unchanged';
      let current: Record<string, unknown> = {};
      let currentText = '';
      let valid = true;
      if (existsSync(file)) {
        currentText = readFileSync(file, 'utf8');
        try {
          current = JSON.parse(currentText) as Record<string, unknown>;
        } catch {
          valid = false;
        }
      }
      if (!valid) {
        ui.note(c.liaraJsonInvalid, c.liaraJsonTitle);
        liaraJson = 'invalid';
      } else {
        const nextText = stable({ ...current, ...desiredLiaraJson(s, deps) });
        if (nextText !== currentText) {
          ui.note(createTwoFilesPatch('liara.json', 'liara.json', currentText, nextText, '', '', { context: 3 }), c.liaraJsonTitle);
          const ok = deps.yes
            ? 'write'
            : await ui.select(c.liaraJsonQuestion, [
                { value: 'write', label: c.write },
                { value: 'skip', label: c.skip },
              ]);
          if (ok === 'write') {
            writeFileSync(file, nextText, 'utf8');
            liaraJson = 'written';
          } else {
            liaraJson = 'skipped';
          }
        }
      }

      // 3) .liaraignore
      const ignore = join(path, '.liaraignore');
      let liaraignore: 'created' | 'exists' = 'exists';
      if (!existsSync(ignore)) {
        writeFileSync(ignore, LIARAIGNORE_DEFAULT, 'utf8');
        liaraignore = 'created';
        ui.note(c.liaraignoreCreated, c.title);
      }

      // 4) disk mount
      const disk = s.provisioned?.disk;
      let diskMount: 'none' | 'set' | 'pending' = 'none';
      if (disk) {
        diskMount = 'disks' in desiredLiaraJson(s, deps) ? 'set' : 'pending';
        if (diskMount === 'pending') ui.note(c.diskMountPending(disk.folders.join(', ')), c.title);
      }

      // 5) production → zero-downtime (R1, new apps only)
      let zeroDowntime: boolean | undefined;
      if (s.goal === 'production' && !s.redeploy) {
        try {
          const r = await setZeroDowntime(deps.liara.settings, app, true, deps.ops, { reasonFa: c.zeroDowntimeReason });
          zeroDowntime = r.status === 'executed';
        } catch (e) {
          // declining the optional suggestion is fine; real errors still stop the step
          if (!(e instanceof ApprovalDeniedError)) throw e;
          zeroDowntime = false;
        }
      }

      s.configured = {
        envKeys: Object.keys(vars).sort(),
        skippedEnv: skipped,
        liaraJson,
        liaraignore,
        diskMount,
        ...(zeroDowntime !== undefined ? { zeroDowntime } : {}),
      };
    },
  };
}
