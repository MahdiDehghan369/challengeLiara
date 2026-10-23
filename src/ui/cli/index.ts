#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { Session } from '../../agent/session.js';
import { startStdioServer } from '../../mcp/server.js';
import { readlineIo, runChat } from './chat.js';
import { startWebPanel } from '../web/server.js';
import { runCli } from './program.js';
import { createRuntime } from './runtime.js';

// CLI entry point (T9.2); no command → chat (T9.6).
export const CLI_NAME = 'siavash';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rt = createRuntime();
  process.exitCode = await runCli(rt, process.argv.slice(2), {
    chat: async (g) => {
      const services = await rt.services(g.yes ? { yes: true } : {});
      const session = Session.latest(services.config.dataDir, { projectPath: rt.cwd }) ?? Session.create(services.config.dataDir, { projectPath: rt.cwd });
      await runChat({
        services,
        ui: rt.ui,
        approver: rt.approver(g.yes ? { yes: true } : {}),
        session,
        io: readlineIo(),
        cwd: rt.cwd,
        isTTY: rt.isTTY,
        ...(g.verbose ? { verbose: true } : {}),
        ...(g.dryRun ? { dryRun: true } : {}),
        ...(g.app ? { app: g.app } : {}),
      });
    },
    mcp: async () => {
      const s = await rt.services();
      // stdio is the protocol channel: the server only answers requests, it prints nothing itself
      // MCP clients start the server from any folder: SIAVASH_PROJECT_DIR names the user's project
      const projectRoot = process.env.SIAVASH_PROJECT_DIR || rt.cwd;
      await startStdioServer({ config: s.config, liara: s.liara, llm: s.llm, urlFor: s.urlFor, projectRoot, audit: s.audit, policy: s.policy });
      await new Promise<void>((resolve) => process.stdin.once('close', resolve));
    },
    ui: async (_g, o) => {
      const s = await rt.services();
      const host = o.host ?? process.env.SIAVASH_UI_HOST ?? '127.0.0.1';
      const port = o.port ?? (process.env.PORT ? Number(process.env.PORT) : 0);
      const token = process.env.SIAVASH_UI_TOKEN || undefined;
      const projectRoot = process.env.SIAVASH_PROJECT_DIR || rt.cwd;
      const panel = await startWebPanel(
        { config: s.config, liara: s.liara, llm: s.llm, urlFor: s.urlFor, projectRoot, audit: s.audit, policy: s.policy, readAudit: () => s.audit.read() },
        { host, port, ...(token ? { token } : {}) },
      );
      rt.out(`پنل سیاوش آماده است (حالت ${s.liara.mode}):\n${token ? panel.url.replace(token, '<SIAVASH_UI_TOKEN>') : panel.url}`);
      await new Promise<void>((resolve) => process.once('SIGINT', () => resolve()).once('SIGTERM', () => resolve()));
      await panel.close();
    },
  });
}
