#!/usr/bin/env node
import { program } from 'commander';
import NetGetMainMenu from './modules/netget_MainMenu.cli.js';
import NetGetX_CLI from './modules/NetGetX/NetGetX.cli.js';

// Entry Points Options and Commands
program
  .description('NetGet Command Line Interface') 
  .action(NetGetMainMenu);

program
  .command('x')
  .description('NetGetX Command Line Interface')
  .action(NetGetX_CLI);

program.parse(process.argv);
