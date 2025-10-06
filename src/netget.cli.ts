#!/usr/bin/env node
import { program } from 'commander';
import NetGetMainMenu from './modules/netget_MainMenu.cli.ts';
import NetGetX_CLI from './modules/NetGetX/NetGetX.cli.ts';

// Entry Points Options and Commands
program
  .description('NetGet Command Line Interface') 
  .action(async () => {
    await NetGetMainMenu();
  });

program
  .command('x')
  .description('NetGetX Command Line Interface')
  .action(async () => {
    await NetGetX_CLI();
  });

program.parse(process.argv);