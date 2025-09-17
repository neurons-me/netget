#!/usr/bin/env node
import { program } from 'commander';
import NetGetX_CLI from './modules/NetGetX/NetGetX.cli.js';
import NetGetMainMenu from './modules/netget_MainMenu.cli.js';
import LocalNetgetCLI from '../local.netget/backend/local.netget.cli.js';
import netGetXDeployMenu from './modules/NetGet_deploy/NetGetX_DeployMenu.cli.js';


// Entry Points Options and Commands
program
  .description('NetGet Command Line Interface') 
  .action(NetGetMainMenu);

program.command('x')
  .description('Directly interact with NetGetX')
  .action(NetGetX_CLI);

program
  .description('Directly interact with Local.Netget')
  .action(LocalNetgetCLI);

program
  .description('NetGet Deployment and Sync Tool')
  .action(netGetXDeployMenu);

program.parse(process.argv);
