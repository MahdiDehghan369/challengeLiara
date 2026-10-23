import { buildConnectionString, normalizeDbKind, waitAppGone, waitForState, type DbKind, type LiaraClient, type WaitOptions } from '../../liara/index.js';
import { createDisk } from '../../ops/backups.js';
import { guardOptions, newPlanId, type OpsContext } from '../../ops/context.js';
import { deleteApp } from '../../ops/delete.js';
import { guard, type ApprovalDecision, type Approver } from '../../safety/approval.js';
import { escalate, Risk, type ActionPlan } from '../../safety/risk.js';
import { isSiavashError, ValidationError } from '../../shared/errors.js';
import { Secret } from '../../shared/secret.js';
import { CANCELLED, type Prompter } from '../../ui/cli/approver.js';
import { fa } from '../../ui/cli/i18n/fa.js';
import type { Step } from '../pipeline-engine.js';
import type { PlanBillingState } from './plan-billing.js';

/**
 * Provision (T5.5): app → (database, separately approved) → disk. Every call goes through the Safety
 * Gate. App and disk were on the R2 deploy-plan card (T5.4), so `deployPlanApprover` approves exactly
 * those; anything else (the database, cleanup) goes to the real approver. Idempotent per pipeline:
 * resources recorded in `state.provisioned` are never created twice. A database failure never deletes
 * the app; cleanup (R3) is offered instead.
 */

export const DISK_NAME = 'data';

/** In-memory secrets handed from provision to configure (never checkpointed: the session is redacted). */
export class SecretStore {
  private readonly values = new Map<string, Secret<string>>();
  set(key: string, value: Secret<string>): void {
    this.values.set(key, value);
  }
  get(key: string): Secret<string> | undefined {
    return this.values.get(key);
  }
  has(key: string): boolean {
    return this.values.has(key);
  }
}

export interface ProvisionState extends PlanBillingState {
  provisioned?: {
    app?: { name: string; planId: string };
    /** `connection`: auto (from Liara), manual (typed by the user), pending (configure must ask). */
    db?: { name: string; type: DbKind; envName: string; connection: 'auto' | 'manual' | 'pending' };
    disk?: { name: string; sizeGb: number; folders: string[] };
  };
}

export interface ProvisionDeps {
  liara: Pick<LiaraClient, 'apps' | 'db' | 'disks'>;
  ui: Prompter;
  ops: OpsContext;
  secrets: SecretStore;
  yes?: boolean;
  /** Database plan id. TODO(OQ-29): no source for db plans; asked from the user when missing. */
  dbPlan?: string;
  /** TODO(OQ-29): disk sizes/prices unknown; 1 GB default. */
  diskGb?: number;
  wait?: Pick<WaitOptions<unknown>, 'timeoutMs' | 'intervalMs' | 'sleep'>;
  /** Connection lookups after creating the database before falling back to manual input. */
  dbPollAttempts?: number;
}

/** Approves only the calls the user already approved on the deploy-plan card; the rest go to `base`. */
export function deployPlanApprover(base: Approver, approved: { app: string; planId: string; disk: boolean }): Approver {
  return {
    request: async (plan, ctx): Promise<ApprovalDecision> => {
      if (plan.target.app === approved.app) {
        if (plan.toolName === 'create_app' && plan.params.planID === approved.planId) return 'approved';
        if (plan.toolName === 'create_disk' && approved.disk) return 'approved';
      }
      return base.request(plan, ctx);
    },
  };
}

function executed<T>(r: { status: string; result?: T }): T {
  if (r.status !== 'executed') throw new ValidationError(`not executed (${r.status})`, { messageFa: fa.provision.notApproved });
  return r.result as T;
}

async function askConnection(ui: Prompter, kind: DbKind): Promise<Secret<string> | undefined> {
  const p = fa.provision;
  if (!ui.password) {
    ui.note(p.noHiddenInput, p.dbManualTitle);
    return undefined;
  }
  const host = await ui.text(p.dbHost);
  if (host === CANCELLED) return undefined;
  const port = await ui.text(p.dbPort, {
    validate: (v) => (/^\d+$/.test(v.trim()) && Number(v) > 0 && Number(v) < 65536 ? undefined : p.dbPortInvalid),
  });
  if (port === CANCELLED) return undefined;
  const user = await ui.text(p.dbUser);
  if (user === CANCELLED) return undefined;
  const password = await ui.password(p.dbPassword);
  if (password === CANCELLED) return undefined;
  const database = await ui.text(p.dbName);
  return buildConnectionString(kind, {
    host: host.trim(),
    port: Number(port),
    user: user.trim(),
    password: new Secret(password),
    database: database === CANCELLED || !database.trim() ? undefined : database.trim(),
  });
}

export function provisionStep<S extends ProvisionState>(deps: ProvisionDeps): Step<S> {
  const p = fa.provision;
  return {
    id: 'provision',
    titleFa: p.title,
    onFail: 'abort',
    skipIf: (ctx) => ctx.state.redeploy === true,
    run: async (ctx) => {
      const s = ctx.state;
      const { apps, db, disks } = deps.liara;
      // acceptance (T5.4): nothing is created without the deploy-plan approval
      if (!s.deployApproval || !s.planChoice || !s.appName || !s.report) {
        throw new ValidationError('deploy plan not approved', { messageFa: p.notApproved });
      }
      const app = s.appName;
      const report = s.report;
      const prov = (s.provisioned ??= {});
      const waitOpts = deps.wait ?? {};
      const diskNeeded = report.deps.disk.needed;
      const planCtx: OpsContext = {
        ...deps.ops,
        approver: deployPlanApprover(deps.ops.approver, { app, planId: s.planChoice.planId, disk: diskNeeded }),
      };

      // 1) app
      if (!prov.app) {
        const platform = report.platform.liaraPlatformId;
        if (!platform) {
          // TODO(OQ-20): only documented platform ids are used; never guessed.
          throw new ValidationError(`no confirmed Liara platform id for ${report.platform.platform}`, {
            messageFa: fa.report.platformUnverified(report.platform.platform),
            details: { fixFa: fa.report.platformUnverifiedFix },
          });
        }
        // created by an interrupted earlier run of this pipeline (the name was free at analyze time)
        if (!(await apps.findApp(app, { fresh: true }))) {
          const plan: ActionPlan = escalate(
            {
              id: newPlanId('create-app'),
              toolName: 'create_app',
              titleFa: p.createAppTitle(app, s.planChoice.planId),
              reasonFa: fa.planBilling.approveReason,
              target: { app },
              risk: Risk.R2,
              costToman: { monthly: s.planChoice.monthlyToman },
              impactFa: p.createAppImpact,
              rollbackFa: p.createAppRollback(app),
              command: `POST /v1/projects {name: ${app}, planID: ${s.planChoice.planId}, platform: ${platform}}`,
              params: { app, planID: s.planChoice.planId, platform },
            },
            deps.ops.risk ?? {},
          );
          executed(
            await guard(
              plan,
              planCtx.approver,
              async (params) => {
                await apps.createApp({ name: app, planID: String(params.planID), platform });
                // async: confirm it shows up in the list
                await waitForState(() => apps.findApp(app, { fresh: true }), (a) => !!a, waitOpts);
                return true;
              },
              guardOptions(planCtx),
            ),
          );
        }
        prov.app = { name: app, planId: s.planChoice.planId };
        ctx.setStatus('running');
      }

      // 2) database (own R2 approval)
      const main = report.deps.databases[0];
      const kind = main && main.type !== 'sqlite' ? normalizeDbKind(main.type) : undefined;
      if (main && main.type !== 'sqlite' && !kind) deps.ui.note(p.dbUnsupported(main.type), p.dbManualTitle);
      if (main && kind) {
        const name = `${app}-db`;
        if (!prov.db) {
          try {
            let plan = deps.dbPlan;
            if (!plan) {
              if (deps.yes) throw new ValidationError('db plan unknown', { messageFa: p.dbPlanNeeded, details: { fixFa: p.dbPlanNeededFix } });
              const typed = await deps.ui.text(p.dbPlanQuestion);
              if (typed === CANCELLED || !typed.trim()) throw new ValidationError('db plan not given', { messageFa: p.dbPlanNeeded });
              plan = typed.trim();
            }
            const dbPlan: ActionPlan = escalate(
              {
                id: newPlanId('create-db'),
                toolName: 'create_database',
                titleFa: p.createDbTitle(name, kind),
                reasonFa: p.createDbReason,
                target: { app, resource: `db:${name}` },
                risk: Risk.R2,
                impactFa: p.createDbImpact,
                rollbackFa: p.createDbRollback(name),
                command: `liara db create -n ${name} -t ${kind} --plan ${plan}`,
                params: { name, type: kind, plan },
              },
              deps.ops.risk ?? {},
            );
            ctx.setStatus('waiting-approval');
            executed(
              await guard(dbPlan, deps.ops.approver, (params) => db.createDb({ name, type: kind, plan: String(params.plan ?? plan) }), guardOptions(deps.ops)),
            );
            ctx.setStatus('running');
          } catch (e) {
            const msg = isSiavashError(e) ? e.messageFa : e instanceof Error ? e.message : String(e);
            deps.ui.note(p.dbFailed(msg), p.dbManualTitle);
            if (!deps.yes) {
              const choice = await deps.ui.select(p.cleanupQuestion(app), [
                { value: 'keep', label: p.cleanupKeep },
                { value: 'delete', label: p.cleanupDelete },
              ]);
              if (choice === 'delete') {
                await deleteApp(
                  { apps: { deleteApp: (n) => apps.deleteApp(n), waitGone: (n) => waitAppGone(apps, n, waitOpts) } },
                  app,
                  deps.ops,
                  { reasonFa: p.cleanupReason },
                );
                delete prov.app;
              }
            }
            throw e;
          }
          prov.db = { name, type: kind, envName: main.envName, connection: 'pending' };
        }

        // connection string → secret store (also after a resume, which loses in-memory secrets)
        if (!deps.secrets.has(main.envName)) {
          let conn: Secret<string> | undefined;
          const attempts = deps.dbPollAttempts ?? 6;
          for (let i = 0; i < attempts && !conn; i++) {
            const c = await db.getDbConnection(name);
            if (c.status === 'ok' && c.connectionString) conn = c.connectionString;
            else if (i < attempts - 1) await (waitOpts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(waitOpts.intervalMs ?? 5_000);
          }
          if (conn) {
            prov.db.connection = 'auto';
          } else {
            const c = await db.getDbConnection(name);
            ctx.setStatus('waiting-human', c.status === 'needs-human' ? c.instructionFa : undefined);
            if (c.status === 'needs-human') deps.ui.note(c.instructionFa, p.dbManualTitle);
            conn = await askConnection(deps.ui, kind);
            prov.db.connection = conn ? 'manual' : 'pending';
            ctx.setStatus('running');
          }
          if (conn) deps.secrets.set(main.envName, conn);
        }
      }

      // 3) disk (on the deploy-plan card)
      if (diskNeeded && !prov.disk) {
        const sizeGb = deps.diskGb ?? 1;
        if (!(await disks.listDisks(app)).disks.some((d) => d.name === DISK_NAME)) {
          executed(await createDisk(disks, app, { name: DISK_NAME, sizeGb }, planCtx, { reasonFa: fa.planBilling.approveReason }));
          await waitForState(
            () => disks.listDisks(app),
            (r) => r.disks.some((d) => d.name === DISK_NAME),
            waitOpts,
          );
        }
        // mount paths are written to liara.json in configure (T5.6). TODO(OQ-21): absolute mount path.
        prov.disk = { name: DISK_NAME, sizeGb, folders: report.deps.disk.folders };
      }
    },
  };
}
