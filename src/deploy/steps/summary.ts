import { writeProjectState } from '../../agent/project-state.js';
import type { LiaraClient } from '../../liara/index.js';
import { listEnvMasked } from '../../ops/env.js';
import type { Prompter } from '../../ui/cli/approver.js';
import { toman } from '../../ui/cli/format.js';
import { fa } from '../../ui/cli/i18n/fa.js';
import type { Step } from '../pipeline-engine.js';
import { defaultAppUrl, type VerifyState } from './verify.js';

/**
 * Summary (T5.10): the final card (URL, plan, monthly cost, created resources, masked envs, health,
 * next commands) and `.siavash/project.json`, so later sessions recognise the project.
 */

export interface SummaryState extends VerifyState {
  summary?: {
    url: string;
    planId?: string;
    monthlyToman?: number;
    resources: string[];
    envKeys: string[];
    verdict?: string;
  };
}

export interface SummaryDeps {
  liara: Pick<LiaraClient, 'env'>;
  ui: Prompter;
  deployMode: 'api' | 'cli';
  urlFor?: (app: string) => string | Promise<string>;
}

export function summaryStep<S extends SummaryState>(deps: SummaryDeps): Step<S> {
  const f = fa.summary;
  return {
    id: 'summary',
    titleFa: f.title,
    onFail: 'abort',
    run: async (ctx) => {
      const s = ctx.state;
      const app = s.appName;
      if (!app || !s.projectPath) throw new Error('summary needs the analyze step first');
      // the public URL (verify may have probed a local stand-in in mock mode)
      const url = await (deps.urlFor ?? defaultAppUrl)(app);
      const prov = s.provisioned;
      const resources = [
        ...(prov?.app ? [f.resApp(prov.app.name)] : []),
        ...(prov?.db ? [f.resDb(prov.db.name, prov.db.type)] : []),
        ...(prov?.disk ? [f.resDisk(prov.disk.name, prov.disk.sizeGb)] : []),
      ];
      // masked values straight from Liara (R0); never the raw values
      const envs = await listEnvMasked(deps.liara.env, app).catch(() => []);
      const lines = [
        f.url(url),
        ...(s.planChoice ? [f.plan(s.planChoice.planId, toman(s.cost?.totalMonthlyToman ?? s.planChoice.monthlyToman))] : []),
        ...(resources.length ? [f.resources(resources.join(f.listSep))] : []),
        envs.length ? f.envs(envs.map((e) => `${e.key}=${e.masked}`).join(f.listSep)) : f.noEnvs,
        ...(s.verify ? [f.health(f.verdict[s.verify.verdict] ?? s.verify.verdict, s.verify.score)] : []),
        '',
        f.next(app),
      ];
      deps.ui.note(lines.join('\n'), f.cardTitle(app));

      writeProjectState(s.projectPath, {
        app,
        ...(s.report ? { platform: s.report.platform.liaraPlatformId ?? s.report.platform.platform, port: s.report.port.port } : {}),
        ...(s.planChoice ? { planID: s.planChoice.planId } : {}),
        deployMode: deps.deployMode,
        ...(s.deployment ? { lastDeploymentId: s.deployment.id } : {}),
      });
      s.summary = {
        url,
        ...(s.planChoice ? { planId: s.planChoice.planId, monthlyToman: s.cost?.totalMonthlyToman ?? s.planChoice.monthlyToman } : {}),
        resources,
        envKeys: envs.map((e) => e.key),
        ...(s.verify ? { verdict: s.verify.verdict } : {}),
      };
    },
  };
}
