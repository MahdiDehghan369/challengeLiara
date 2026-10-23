import { basename, resolve } from 'node:path';
import { readProjectState } from '../../agent/project-state.js';
import { analyzeProject, type ProjectReport } from '../../analyzer/report.js';
import type { LiaraClient } from '../../liara/index.js';
import type { LlmClient } from '../../llm/types.js';
import type { Goal } from '../../planner/recommend.js';
import { ApprovalDeniedError } from '../../shared/errors.js';
import { CANCELLED, type Prompter } from '../../ui/cli/approver.js';
import { fa } from '../../ui/cli/i18n/fa.js';
import type { PipelineState, Step } from '../pipeline-engine.js';

/**
 * Analyze & Clarify (T5.3): runs the project analysis, shows the summary, asks the LLM's questions,
 * the app name (kebab-case from the folder, unique among the user's apps), and the goal.
 * With `--yes` defaults are taken, except for blockers, which always need an explicit answer.
 */

/**
 * Our conservative app-name rule. TODO(OQ-31): Liara's exact naming rules; names may also be taken
 * by other accounts, which only `createApp` (409 → APP_NAME_TAKEN) can tell.
 */
export const APP_NAME_RE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;

export function suggestAppName(folder: string): string {
  const kebab = folder
    .normalize('NFKD')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const named = /^[a-z]/.test(kebab) ? kebab : `app-${kebab || 'siavash'}`;
  return named.slice(0, 32).replace(/-+$/, '');
}

/** First free `name`, `name-2`, `name-3`, … among `taken`. */
export function freeAppName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  for (let i = 2; ; i++) {
    const suffix = `-${i}`;
    const candidate = `${name.slice(0, 32 - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export interface AnalyzeState extends PipelineState {
  projectPath?: string;
  report?: ProjectReport;
  answers?: Record<string, string>;
  appName?: string;
  /** True when deploying again to the app recorded in `.siavash/project.json`. */
  redeploy?: boolean;
  goal?: Goal;
}

export interface AnalyzeStepDeps {
  projectPath: string;
  liara: Pick<LiaraClient, 'apps'>;
  ui: Prompter;
  llm?: LlmClient;
  useLlm?: boolean;
  /** `--yes`: take defaults without asking (blockers are still asked). */
  yes?: boolean;
}

function cancelled(): never {
  throw new ApprovalDeniedError('cancelled by user', { messageFa: fa.analyzeStep.cancelled });
}

function showReport(ui: Prompter, r: ProjectReport): void {
  const a = fa.analyzeStep;
  ui.note(
    [
      a.summary({
        platform: r.platform.platform,
        port: r.port.port,
        ...(r.scripts.start ? { start: r.scripts.start } : {}),
        ...(r.scripts.build ? { build: r.scripts.build } : {}),
        dbs: r.deps.databases.map((d) => d.type),
        diskFolders: r.deps.disk.folders,
        files: r.size.files,
        mb: r.size.mb,
        warnings: r.warnings.filter((w) => w.severity !== 'blocker').length,
        missingEnv: r.missingEnv,
      }),
      r.summaryFa,
    ]
      .filter(Boolean)
      .join('\n\n'),
    a.summaryTitle,
  );
  const warnings = r.warnings.filter((w) => w.severity === 'warning');
  if (warnings.length > 0) ui.note(warnings.map((w) => a.warningLine(w.messageFa, w.fixFa)).join('\n'), a.warningsTitle);
}

export function analyzeStep<S extends AnalyzeState>(deps: AnalyzeStepDeps): Step<S> {
  const a = fa.analyzeStep;
  return {
    id: 'analyze',
    titleFa: a.title,
    onFail: 'abort',
    run: async (ctx) => {
      const { ui } = deps;
      const path = resolve(deps.projectPath);
      const report = await analyzeProject(path, {
        useLlm: deps.useLlm ?? !!deps.llm,
        ...(deps.llm ? { llm: deps.llm } : {}),
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      ctx.state.projectPath = path;
      ctx.state.report = report;
      showReport(ui, report);

      // Blockers: always an explicit decision, even with --yes.
      // TODO(T4.8): add «درستش کن» (route to T8.15) once check_readiness exists.
      if (report.blockers.length > 0) {
        ui.note(report.blockers.map((b) => a.warningLine(b.messageFa, b.fixFa)).join('\n'), a.blockersTitle);
        const choice = await ui.select(a.blockerChoice, [
          { value: 'cancel', label: a.blockerCancel },
          { value: 'continue', label: a.blockerContinue },
        ]);
        if (choice !== 'continue') cancelled();
      }

      const answers: Record<string, string> = {};
      if (!deps.yes) {
        for (const q of report.questions) {
          const ans = await ui.text(q);
          if (ans === CANCELLED) cancelled();
          if (ans.trim()) answers[q] = ans.trim();
        }
      }
      ctx.state.answers = answers;

      // Redeploy to the app this project was deployed to before?
      const previous = readProjectState(path)?.app;
      if (previous) {
        const choice = deps.yes
          ? 'same'
          : await ui.select(a.redeployQuestion(previous), [
              { value: 'same', label: a.redeploySame(previous) },
              { value: 'new', label: a.redeployNew },
            ]);
        if (choice === CANCELLED) cancelled();
        if (choice === 'same') {
          ctx.state.redeploy = true;
          ctx.state.appName = previous;
        }
      }

      if (!ctx.state.redeploy) {
        ctx.state.redeploy = false;
        const taken = new Set((await deps.liara.apps.listApps({ fresh: true })).map((x) => x.name));
        const suggestion = freeAppName(suggestAppName(basename(path)), taken);
        if (deps.yes) {
          ctx.state.appName = suggestion;
        } else {
          const name = await ui.text(a.appNameQuestion, {
            initialValue: suggestion,
            validate: (v) => {
              const n = v.trim();
              if (!APP_NAME_RE.test(n)) return a.appNameInvalid;
              if (taken.has(n)) return a.appNameTaken(n, freeAppName(n, taken));
              return undefined;
            },
          });
          if (name === CANCELLED) cancelled();
          ctx.state.appName = name.trim();
        }
      }

      if (deps.yes) {
        ctx.state.goal = 'test';
      } else {
        const goal = await ui.select<Goal>(a.goalQuestion, [
          { value: 'test', label: a.goalTest },
          { value: 'production', label: a.goalProduction },
        ]);
        if (goal === CANCELLED) cancelled();
        ctx.state.goal = goal;
      }
    },
  };
}
