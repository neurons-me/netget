// xState.ts
import chalk from 'chalk';

interface XStateData {
    getPath?: string;
    static?: string;
    devPath?: string;
    devStatic?: string;
    xMainOutPutPort?: number;
    publicIP?: string;
    localIP?: string;
    [key: string]: any; // Allow additional properties
}

let xState: XStateData = {};

/**
 * Initializes the X State with the provided data.
 * @param data - The data to initialize the X State with.
 * @category NetGetX
 * @subcategory General
*/
export const initializeState = (data: XStateData): void => {
    xState = { ...data };
    console.log(chalk.cyan('X State Initialized.'));
    // console.log(chalk.cyan(`Configuration attached: ${JSON.stringify(xState, null, 2)}`));
};

/**
 * Returns the current X State.
 * @returns The current X State.
 */
export const getState = (): XStateData => {
    return xState;
};

/**
 * Updates the X State with the provided data.
 * @param newData - The data to update the X State with.
 */
export const updateState = (newData: Partial<XStateData>): void => {
    xState = { ...xState, ...newData };
    console.log(chalk.green('X State Updated.'));
    console.log(chalk.cyan(`Current State: ${JSON.stringify(xState, null, 2)}`));
};

export type { XStateData };