// netget/src/modules/NetGetX/config/x_StateAndConfig.js
import { getConfig } from './getConfig.js';
/**
 * Displays a comparison table of the xConfig and the current state.
 *
 * @param {Object} stateX - The current state to compare with the xConfig.
 * @returns {Promise<void>} - A promise that resolves when the comparison is complete.
 * @category NetGetX
 * @subcategory Config
 * @module x_StateAndConfig
 */
async function displayStateAndConfig(stateX) {
    let x = await getConfig();
    console.log('Comparison xConfig and Actual State:');
    const combinedData = [];
    const keys = new Set([...Object.keys(x), ...Object.keys(stateX)]);
    keys.forEach((key) => {
        const isEqual = x[key] === stateX[key] ? '✓' : '✗';
        combinedData.push({
            'xConfig Key': key,
            'xConfig Value': x[key],
            'xState Key': key,
            'xState Value': stateX[key],
            'Match': isEqual
        });
    });
    console.table(combinedData);
}
export default displayStateAndConfig;