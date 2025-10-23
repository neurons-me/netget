// netget/src/modules/Srvrs/srvrs.cli.ts
import inquirer from "inquirer";
import chalk from "chalk";
import NetGetMainMenu from "../netget_MainMenu.cli.ts";
/**
 * Displays the Gateways Menu and handles user input.
 * @category Gateways
 * @subcategory Main    
 * @module Srvrs_CLI
 */

export async function Srvrs_CLI(): Promise<void> {
    console.clear();
    console.log(`
             __________________ 
            |   SRVRS PORTS    |---->>>
            |_______.P.________|---->>>
HTTPS--->>> |_______.R.________|---->>>  
            |_______.O.________|---->>>
            |_______.X.________|---->>>
            |_______.Y.________|---->>>
     `);
     const actions = ['Go Back'];
     const { action } = await inquirer.prompt({
         type: 'list',
         name: 'action',
         message: 'Select an action:',
         choices: actions,
     });

     switch (action) {
         case 'Go Back':
             console.clear();  // Clear the console when going back to the main menu
             console.log(chalk.blue('Returning to the main menu...'));
             await NetGetMainMenu();
             return;
     }
}

export default Srvrs_CLI;
