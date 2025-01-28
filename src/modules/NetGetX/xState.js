// xState.js
import chalk from 'chalk';
let xState = {};

/**
 * Initializes the X State with the provided data.
 * @param {Object} data - The data to initialize the X State with.
 * @category NetGetX
 * @subcategory General
*/
export const initializeState = (data) => {
    xState = { ...data };
    console.log(chalk.cyan('X State Initialized.'));
    // console.log(chalk.cyan(`Configuration attached: ${JSON.stringify(xState, null, 2)}`));
};

/**
 * Returns the current X State.
 * @returns {Object} - The current X State.
 */
export const getState = () => {
    return xState;
};

/**
 * Updates the X State with the provided data.
 * @param {Object} newData - The data to update the X State with.
 */
export const updateState = (newData) => {
    xState = { ...xState, ...newData };
    console.log(chalk.green('X State Updated.'));
    console.log(chalk.cyan(`Current State: ${JSON.stringify(xState, null, 2)}`));
};
