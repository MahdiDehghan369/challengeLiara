#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { Session } from '../../agent/session.js';
import { readlineIo, runChat } from './chat.js';
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
  });
}
