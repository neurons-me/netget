#!/usr/bin/env node
import { program } from 'commander';
import NetGetX_CLI from './modules/NetGetX/NetGetX.cli.js';
import NetGetMainMenu from './modules/netget_MainMenu.cli.js';

// Entry Points Options and Commands
program
  .description('NetGet Command Line Interface') 
  .action(NetGetMainMenu);

program.command('x')
  .description('Directly interact with NetGetX')
  .action(NetGetX_CLI);

program.parse(process.argv);
