import pc from 'picocolors';
import type { AppOverview } from '../../../ops/service.js';
import { redactText } from '../../../safety/redact.js';
import type { HealthScore } from '../../../sre/health-score.js';
import type { ComparisonRow } from '../../../sre/verify.js';
import { bytes, formatNumber, percentBar, relTime } from '../format.js';
import { fa } from '../i18n/fa.js';
import { capLines, type CardOptions } from './findings.js';

/** Overview, health-score and before/after cards (T9.4). */

const c = fa.cards;

export function renderHealthLine(h: HealthScore, opts: CardOptions = {}): string {
  const colors = pc.createColors(opts.color ?? pc.isColorSupported);
  const paint = h.label === 'critical' ? colors.red : h.label === 'attention' ? colors.yellow : colors.green;
  return [`${c.health} ${paint(`${percentBar(h.score, 20)} — ${h.labelFa}`)}`, h.summaryFa].join('\n');
}

export function renderOverviewCard(o: AppOverview, opts: CardOptions & { health?: HealthScore; now?: number } = {}): string {
  const colors = pc.createColors(opts.color ?? pc.isColorSupported);
  const lines: string[] = [colors.bold(c.overviewTitle(o.app))];
  if (opts.health) lines.push(renderHealthLine(opts.health, opts));
  if (o.status.ok) lines.push(c.status(o.status.value.status ?? '—', o.status.value.scale ?? 0));
  if (o.plan.ok && o.plan.value) {
    const p = o.plan.value;
    lines.push(c.plan(p.id, bytes(p.ramMb * 1024 * 1024), formatNumber(p.cpu, { decimals: 1 })));
  }
  if (o.lastDeploy.ok) {
    const d = o.lastDeploy.value;
    lines.push(d ? c.lastDeploy(relTime(d.startedAt, opts.now), d.result, d.version ?? '') : c.noDeploy);
  }
  if (o.envCount.ok) lines.push(c.envCount(o.envCount.value));
  if (o.domains.ok && o.domains.value.length) {
    lines.push(c.domains, ...o.domains.value.map((d) => `  ${c.domainLine(d.name, d.certificatesStatus ?? '—')}`));
  }
  if (o.disks.ok && o.disks.value.length) {
    lines.push(c.disks, ...o.disks.value.map((d) => `  ${d.name}: ${d.usagePercent === undefined ? '—' : percentBar(d.usagePercent, 12)}`));
  }
  if (o.metrics.ok && o.metrics.value.applets.length) {
    lines.push(c.resources);
    for (const a of o.metrics.value.applets) {
      const cpu = a.cpuPct !== undefined ? percentBar(a.cpuPct, 12) : a.cpu !== undefined ? c.rawValue(formatNumber(a.cpu, { decimals: 2 })) : '—';
      const mem = a.memoryPct !== undefined ? percentBar(a.memoryPct, 12) : a.memory !== undefined ? c.rawValue(formatNumber(a.memory, { decimals: 0 })) : '—';
      lines.push(`  ${a.applet}: ${c.cpu} ${cpu} · ${c.memory} ${mem}`);
    }
  }
  if (o.probe.ok) {
    const p = o.probe.value;
    lines.push(c.probe(percentBar(p.availability ?? 0, 12), p.p95 === undefined ? '—' : c.ms(formatNumber(p.p95, { decimals: 0 }))));
  }
  if (o.events.ok && o.events.value.length) {
    const last = o.events.value.slice(-3);
    lines.push(c.events, ...last.map((e) => `  ${e.ts ? relTime(e.ts, opts.now) : '—'} · ${e.kind} · ${redactText(e.message).slice(0, 100)}`));
  }
  if (o.failed.length) lines.push(colors.yellow(c.failed(o.failed.join(', '))));
  return capLines(lines.join('\n').split('\n'), opts).join('\n');
}

const visible = (s: string) => [...s].length;
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - visible(s)));

/** The verify before/after table (T8.10 rows), aligned in columns. */
export function renderComparisonTable(rows: ComparisonRow[], opts: CardOptions = {}): string {
  const colors = pc.createColors(opts.color ?? pc.isColorSupported);
  const [h1, h2, h3] = c.compareHead;
  const body = rows.map((r) => [r.labelFa, r.before, r.after, r.better === true ? colors.green(c.better) : r.better === false ? colors.red(c.worse) : c.same]);
  const widths = [0, 1, 2].map((i) => Math.max(visible([h1, h2, h3][i] as string), ...body.map((b) => visible(b[i] as string))));
  const row = (cells: string[]) => cells.map((cell, i) => (i < 3 ? pad(cell, widths[i] as number) : cell)).join('  ').trimEnd();
  return capLines([colors.bold(c.compareTitle), row([h1, h2, h3, '']), ...body.map(row)], opts).join('\n');
}
