#!/usr/bin/env ts-node

import { runUiCommand } from './commands/ui';

void runUiCommand(process.argv.slice(2)).then((code) => {
  process.exit(code);
});

