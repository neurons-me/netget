#!/usr/bin/env node
import { program } from 'commander';
import NetGetMainMenu from './modules/netget_MainMenu.cli.ts';
import NetGetX_CLI from './modules/NetGetX/NetGetX.cli.ts';
import { i_DefaultNetGetX } from './modules/NetGetX/config/i_DefaultNetGetX.ts';

// Entry Points Options and Commands
program
  .description('NetGet Command Line Interface') 
  .action(async () => {
    console.log('Initializing NetGet CLI...');
    // await i_DefaultNetGetX();
    await NetGetMainMenu();
  });

program
  .command('x')
  .description('NetGetX Command Line Interface')
  .action(async () => {
    await NetGetX_CLI();
  });

program.parse(process.argv);