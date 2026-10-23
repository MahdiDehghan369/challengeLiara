#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { runCli } from './program.js';
import { createRuntime } from './runtime.js';

// CLI entry point (T9.2).
export const CLI_NAME = 'siavash';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli(createRuntime(), process.argv.slice(2));
}
