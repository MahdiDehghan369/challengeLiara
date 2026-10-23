import { fa } from '../../ui/cli/i18n/fa.js';
import type { Incident } from '../incident.js';

/**
 * Incident report templates (T8.11): Markdown and a single-file HTML (RTL, inline CSS, no external
 * resources). The fixed Persian section titles come from `fa.incident.sections`.
 */

const f = fa.incident;
const time = (iso: string | undefined) => (iso ? `${iso.replace('T', ' ').slice(0, 16)} UTC` : '—');

interface Section {
  title: string;
  /** Markdown body. */
  md: string;
  /** Lines rendered as paragraphs / list items in HTML. */
  lines: string[];
  table?: { head: string[]; rows: string[][] };
  list?: boolean;
}

function sections(i: Incident): Section[] {
  const s = f.sections;
  const top = i.hypotheses[0];
  const topSignal = [...i.signals].sort((a, b) => (a.severity === 'critical' ? -1 : 0) - (b.severity === 'critical' ? -1 : 0))[0];
  const summary = i.summaryFa ?? (topSignal ? f.defaultSummary(i.signals.length, top?.titleFa ?? topSignal.titleFa) : f.noSignals);
  const impact = i.impactFa ?? (i.signals.length ? f.defaultImpact(i.signals.map((x) => x.titleFa).join(fa.summary.listSep)) : f.noSignals);

  const timeline = [
    { ts: i.openedAt, text: f.kind[i.kind] ?? i.kind },
    ...i.timeline.map((t) => ({ ts: new Date(t.ts).toISOString(), text: `${t.kind}: ${t.text}` })),
    ...i.actions.map((a) => ({ ts: a.ts, text: `${a.tool} (${a.risk}) → ${a.result}` })),
    ...(i.closedAt ? [{ ts: i.closedAt, text: f.status[i.status] ?? i.status }] : []),
  ].sort((a, b) => a.ts.localeCompare(b.ts));
  const timelineLines = timeline.map((t) => `${time(t.ts)} — ${t.text}`);

  const rootLines = top
    ? [`**${top.titleFa}** (${f.confidence(Math.round(top.confidence * 100))})`, top.explanationFa, ...i.hypotheses.slice(1).map((h) => `${h.titleFa} (${f.confidence(Math.round(h.confidence * 100))})`)]
    : [f.noRootCause];

  const evidenceLines = top?.evidence.length
    ? top.evidence.map((e) => `[${e.type}] ${e.quote}`)
    : i.signals.flatMap((sig) => (sig.evidence.logRefs ?? []).slice(0, 2).map((r) => `[log] ${r.snippet.split('\n')[0]}`));

  const actionLines = i.actions.length ? i.actions.map((a) => f.actionLine(time(a.ts), a.tool, a.risk, a.result)) : [f.noActions];

  const v = i.verification;
  const prevention = i.preventionFa ?? [f.prevention[top?.category ?? ''] ?? f.prevention.generic!, f.prevention.generic!].filter((x, k, arr) => arr.indexOf(x) === k);

  return [
    { title: s.summary, md: summary, lines: [summary] },
    { title: s.impact, md: impact, lines: [impact] },
    { title: s.timeline, md: timelineLines.map((l) => `- ${l}`).join('\n'), lines: timelineLines, list: true },
    { title: s.rootCause, md: rootLines.join('\n\n'), lines: rootLines },
    { title: s.evidence, md: evidenceLines.map((l) => `- \`${l.replace(/`/g, "'")}\``).join('\n') || '—', lines: evidenceLines.length ? evidenceLines : ['—'], list: true },
    { title: s.actions, md: actionLines.map((l) => `- ${l}`).join('\n'), lines: actionLines, list: true },
    v
      ? {
          title: s.verification,
          md: [f.verdict(v.verdictFa), '', f.tableHead, '|---|---|---|', ...v.table.map((r) => `| ${r.labelFa} | ${r.before} | ${r.after} |`)].join('\n'),
          lines: [f.verdict(v.verdictFa)],
          table: { head: f.tableHead.split('|').map((x) => x.trim()).filter(Boolean), rows: v.table.map((r) => [r.labelFa, r.before, r.after]) },
        }
      : { title: s.verification, md: f.notVerified, lines: [f.notVerified] },
    { title: s.prevention, md: prevention.map((p) => `- ${p}`).join('\n'), lines: prevention, list: true },
  ];
}

function header(i: Incident): { title: string; meta: string } {
  return {
    title: f.title(i.app, i.id),
    meta: f.meta(f.kind[i.kind] ?? i.kind, f.status[i.status] ?? i.status, f.severity[i.severity] ?? i.severity, time(i.openedAt), time(i.closedAt)),
  };
}

export function renderIncidentMarkdown(i: Incident, now: Date): string {
  const h = header(i);
  return [`# ${h.title}`, '', h.meta, '', ...sections(i).flatMap((s) => [`## ${s.title}`, '', s.md, '']), '---', f.footer(time(now.toISOString())), ''].join('\n');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Minimal inline markdown for HTML: **bold** only. */
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

export function renderIncidentHtml(i: Incident, now: Date): string {
  const h = header(i);
  const body = sections(i)
    .map((s) => {
      const content = s.list ? `<ul>${s.lines.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>` : s.lines.map((l) => `<p>${inline(l)}</p>`).join('');
      const table = s.table
        ? `<table><thead><tr>${s.table.head.map((x) => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${s.table.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
        : '';
      return `<section><h2>${esc(s.title)}</h2>${content}${table}</section>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(h.title)}</title>
<style>
:root{--bg:#fff;--fg:#1d1d1f;--muted:#6e6e73;--line:#e5e5ea;--accent:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--fg:#f2f2f7;--muted:#a1a1a6;--line:#2c2c2e;--accent:#ff6b5b}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.7 Vazirmatn,Tahoma,system-ui,sans-serif}
main{max-width:860px;margin:0 auto;padding:24px 16px}
h1{font-size:1.5rem;margin:0 0 4px}h2{font-size:1.15rem;margin:28px 0 8px;border-bottom:1px solid var(--line);padding-bottom:4px}
.meta{color:var(--muted);font-size:.9rem}li{margin:4px 0}code{direction:ltr;unicode-bidi:embed}
table{border-collapse:collapse;width:100%;margin-top:8px}th,td{border:1px solid var(--line);padding:6px 8px;text-align:right}
footer{margin-top:32px;color:var(--muted);font-size:.85rem}
</style>
</head>
<body><main>
<h1>${esc(h.title)}</h1>
<p class="meta">${esc(h.meta)}</p>
${body}
<footer>${esc(f.footer(time(now.toISOString())))}</footer>
</main></body>
</html>
`;
}
