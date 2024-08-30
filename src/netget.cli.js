#!/usr/bin/env node
import { program } from 'commander';
import packageJson from './package.json'; // Import the package.json file to access the version

import NetGetX_CLI from './modules/NetGetX/NetGetX.cli.js';
import { Gateways_CLI } from './modules/Gateways/gateways.cli.js';
import { handleGets } from './modules/Gets/Gets.js';
import NetGetMainMenu from './modules/netget_MainMenu.cli.js';
import { manageGateway } from './modules/Gateways/gatewayPM2.js';

// Entry Points Options and Commands
program
  .description('NetGet Command Line Interface')
  .version(packageJson.version) 
  .action(NetGetMainMenu);

program.command('x')
  .description('Directly interact with NetGetX')
  .action(NetGetX_CLI);

program.command('gateways')
  .description('Directly manage your Gateways')
  .action(Gateways_CLI);

program.command('gets')
  .description('Directly configure and manage your Gets')
  .action(handleGets);

// Add gateway management commands
program.command('gateway:start <name>')
  .description('Start a gateway')
  .action((name) => {
    manageGateway(name, 'start');
  });

program.command('gateway:stop <name>')
  .description('Stop a gateway')
  .action((name) => {
    manageGateway(name, 'stop');
  });

program.command('gateway:restart <name>')
  .description('Restart a gateway')
  .action((name) => {
    manageGateway(name, 'restart');
  });

program.command('gateway:delete <name>')
  .description('Delete a gateway')
  .action((name) => {
    manageGateway(name, 'delete');
  });

program.command('gateway:status <name>')
  .description('Check the status of a gateway')
  .action((name) => {
    manageGateway(name, 'status');
  });

program.parse(process.argv);
