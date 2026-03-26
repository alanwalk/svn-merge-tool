#!/usr/bin/env ts-node

import { runCleanupCommand } from './commands/cleanup';
import { runMergeCommand } from './commands/run';
import { runUiCommand } from './commands/ui';
import { getPackageVersion } from './utils';

const APP_VERSION = getPackageVersion();

function printRootHelp(): void {
  console.log(`svn-merge-tool ${APP_VERSION}

用法:
  svnmerge <command> [options]
  svnmerge [run options]

命令:
  run        执行命令行合并
  cleanup    将工作副本恢复为干净状态
  ui         打开 WebUI（等价于 svnmerge-ui）

说明:
  不带子命令时，svnmerge 默认等价于 svnmerge run。
  查看各命令帮助：
    svnmerge run --help
    svnmerge cleanup --help
    svnmerge ui --help
    svnmerge-ui --help
`);
}

async function main(): Promise<void> {
  const [, , subcommand, ...rest] = process.argv;

  if (!subcommand) {
    process.exit(await runMergeCommand([]));
  }

  if (subcommand === '--help' || subcommand === '-h') {
    printRootHelp();
    process.exit(0);
  }

  if (subcommand === '--version' || subcommand === '-v') {
    console.log(APP_VERSION);
    process.exit(0);
  }

  if (subcommand === 'run') {
    process.exit(await runMergeCommand(rest));
  }

  if (subcommand === 'cleanup') {
    process.exit(await runCleanupCommand(rest));
  }

  if (subcommand === 'ui') {
    process.exit(await runUiCommand(rest));
  }

  if (subcommand.startsWith('-')) {
    process.exit(await runMergeCommand([subcommand, ...rest]));
  }

  console.error(`Unknown command: ${subcommand}`);
  console.error('Run `svnmerge --help` to see available commands.');
  process.exit(3);
}

void main();

