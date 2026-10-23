import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readAudit, type AuditEntry } from '../safety/audit.js';
import { redactObject, redactText } from '../safety/redact.js';
import type { Signal } from './detectors/types.js';
import type { Hypothesis, TimelineItem } from './rca.js';
import { renderIncidentHtml, renderIncidentMarkdown } from './templates/incident.js';
import type { ComparisonRow, FixVerdict } from './verify.js';

/**
 * Incident model and report (T8.11). Reports go to `reports/incidents/<id>.md` and a single-file HTML for
 * the demo. Everything is redacted twice: the incident object and the final rendered text.
 */

export type IncidentKind = 'runtime' | 'deploy-failure' | 'build-failure';
export type IncidentStatus = 'open' | 'waiting-fix' | 'resolved' | 'gave-up';

export interface IncidentAction {
  ts: string;
  tool: string;
  risk: string;
  result: string;
  decision?: string;
}

export interface Incident {
  id: string;
  app: string;
  kind: IncidentKind;
  openedAt: string;
  closedAt?: string;
  severity: 'critical' | 'warn' | 'info';
  status: IncidentStatus;
  summaryFa?: string;
  impactFa?: string;
  signals: Signal[];
  hypotheses: Hypothesis[];
  timeline: TimelineItem[];
  actions: IncidentAction[];
  verification?: { verdict: FixVerdict; verdictFa: string; table: ComparisonRow[] };
  preventionFa?: string[];
}

export function newIncidentId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  return `inc-${stamp}-${randomBytes(2).toString('hex')}`;
}

export function createIncident(input: { app: string; kind: IncidentKind; signals: Signal[]; hypotheses?: Hypothesis[]; timeline?: TimelineItem[]; now?: Date; id?: string }): Incident {
  const now = input.now ?? new Date();
  const severity = input.signals.some((s) => s.severity === 'critical') ? 'critical' : input.signals.some((s) => s.severity === 'warn') ? 'warn' : 'info';
  return {
    id: input.id ?? newIncidentId(now),
    app: input.app,
    kind: input.kind,
    openedAt: now.toISOString(),
    severity,
    status: 'open',
    signals: input.signals,
    hypotheses: input.hypotheses ?? [],
    timeline: input.timeline ?? [],
    actions: [],
  };
}

/** Actions taken for this app since the incident opened, from the audit log (no secret values in it). */
export function actionsFromAudit(dataDir: string, app: string, since: string): IncidentAction[] {
  return readAudit(dataDir, { since, app }).map((e: AuditEntry) => ({ ts: e.ts, tool: e.tool, risk: e.risk, result: e.result, decision: e.decision }));
}

export interface IncidentReportFiles {
  markdown: string;
  html: string;
}

/** Renders both formats (redacted) without writing. */
export function renderIncident(incident: Incident, now: Date = new Date()): { markdown: string; html: string } {
  const safe = redactObject(incident) as Incident;
  return { markdown: redactText(renderIncidentMarkdown(safe, now)), html: redactText(renderIncidentHtml(safe, now)) };
}

export function writeIncidentReport(reportsDir: string, incident: Incident, now: Date = new Date()): IncidentReportFiles {
  const dir = join(reportsDir, 'incidents');
  mkdirSync(dir, { recursive: true });
  const { markdown, html } = renderIncident(incident, now);
  const files = { markdown: join(dir, `${incident.id}.md`), html: join(dir, `${incident.id}.html`) };
  writeFileSync(files.markdown, markdown, 'utf8');
  writeFileSync(files.html, html, 'utf8');
  return files;
}
