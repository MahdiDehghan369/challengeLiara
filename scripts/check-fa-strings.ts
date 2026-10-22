/**
 * T9.1 acceptance check: no Persian text in src/ outside the i18n table, prompts and the
 * knowledge base. Comments and Persian digits are ignored.
 *
 *   pnpm check:fa
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Arabic-script letters plus Arabic punctuation (Script=Common), excluding Persian and Arabic-Indic digits. */
const PERSIAN_TEXT_RE = /(?![۰-۹٠-٩])\p{Script=Arabic}|[،؛؟]/u;

const ALLOWED_DIRS = ['ui/cli/i18n/', 'prompts/', 'knowledge/'];

export interface StrayPersian {
  file: string;
  line: number;
  text: string;
}

function stripComments(source: string): string[] {
  // Replace comment bodies with spaces so line numbers stay intact; strings containing `//`
  // (URLs) are kept because the line comment must not start inside quotes.
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return noBlock.split('\n').map((l) => {
    let quote: string | undefined;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = undefined;
      } else if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '/' && l[i + 1] === '/') return l.slice(0, i);
    }
    return l;
  });
}

function walk(dir: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith('.ts')) out.push(p);
  }
}

export function findStrayPersian(srcDir: string): StrayPersian[] {
  const files: string[] = [];
  walk(srcDir, files);
  const found: StrayPersian[] = [];
  for (const f of files.sort()) {
    const rel = relative(srcDir, f).split(sep).join('/');
    if (ALLOWED_DIRS.some((d) => rel.startsWith(d) || rel.includes(`/${d}`))) continue;
    stripComments(readFileSync(f, 'utf8')).forEach((l, i) => {
      if (PERSIAN_TEXT_RE.test(l)) found.push({ file: rel, line: i + 1, text: l.trim() });
    });
  }
  return found;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const found = findStrayPersian(join(process.cwd(), 'src'));
  for (const s of found) console.error(`src/${s.file}:${s.line}: ${s.text}`);
  if (found.length > 0) {
    console.error(`\n${found.length} line(s) with Persian text outside src/ui/cli/i18n (move them to fa.ts).`);
    process.exit(1);
  }
  console.log('OK: no Persian text outside i18n / prompts / knowledge.');
}
