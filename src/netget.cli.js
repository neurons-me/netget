#!/usr/bin/env node
import { program } from 'commander';

import NetGetX_CLI from './modules/NetGetX/NetGetX.cli.js';
import { App_CLI } from './modules/Gateways/gateways.cli.js';
import { handleGets } from './modules/Gets/Gets.js';
import NetGetMainMenu from './modules/netget_MainMenu.cli.js';
import { manageApp } from './modules/Gateways/gatewayPM2.js';

// Entry Points Options and Commands
program
  .description('NetGet Command Line Interface') 
  .action(NetGetMainMenu);

program.command('x')
  .description('Directly interact with NetGetX')
  .action(NetGetX_CLI);

program.command('gateways')
  .description('Directly manage your Gateways')
  .action(App_CLI);

program.command('gets')
  .description('Directly configure and manage your Gets')
  .action(handleGets);

// Add gateway management commands
program.command('gateway:start <name>')
  .description('Start a gateway')
  .action((name) => {
    manageApp(name, 'start');
  });

program.command('gateway:stop <name>')
  .description('Stop a gateway')
  .action((name) => {
    manageApp(name, 'stop');
  });

program.command('gateway:restart <name>')
  .description('Restart a gateway')
  .action((name) => {
    manageApp(name, 'restart');
  });

program.command('gateway:delete <name>')
  .description('Delete a gateway')
  .action((name) => {
    manageApp(name, 'delete');
  });

program.command('gateway:status <name>')
  .description('Check the status of a gateway')
  .action((name) => {
    manageApp(name, 'status');
  });

program.parse(process.argv);
