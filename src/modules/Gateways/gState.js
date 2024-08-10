// gState.js
import chalk from 'chalk';
let gState = {};

/**
 *
 * @param {Object} data 
 * @category Gateways
 * @subcategory Main
 * @module gState
 */
export const initializeState = (data) => {
    gState = { ...data };
    console.log(chalk.cyan('G State Initialized.'));
    //console.log(chalk.cyan(`Configuration attached: ${JSON.stringify(xState, null, 2)}`));
};

/**
 * 
 * @returns {Object} - The current X State.
 */
export const getState = () => {
    return gState;
};

/**
 * Updates the X State with the provided data.
 * @param {Object} newData - The data to update the X State with.
 * @category Gateways
 * @subcategory Main
 * @module gState
 */
export const updateState = (newData) => {
    gState = { ...gState, ...newData };
    console.log(chalk.green('X State Updated.'));
    console.log(chalk.cyan(`Current State: ${JSON.stringify(gState, null, 2)}`));
};
