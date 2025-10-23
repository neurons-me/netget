// netget/src/modules/NetGetX/config/x_StateAndConfig.ts
import { getConfig } from './getConfig.ts';
import type { XConfig } from './xConfig.ts';
import type { XStateData } from '../xState.ts';

// Interface for comparison table data
interface ComparisonData {
    'xConfig Key': string;
    'xConfig Value': any;
    'xState Key': string;
    'xState Value': any;
    'Match': string;
}

/**
 * Displays a comparison table of the xConfig and the current state.
 *
 * @param stateX - The current state to compare with the xConfig.
 * @returns A promise that resolves when the comparison is complete.
 * @category NetGetX
 * @subcategory Config
 * @module x_StateAndConfig
 */
async function displayStateAndConfig(stateX: XStateData): Promise<void> {
    const x: XConfig | {} = await getConfig();
    console.log('Comparison xConfig and Actual State:');
    
    const combinedData: ComparisonData[] = [];
    const keys: Set<string> = new Set([...Object.keys(x), ...Object.keys(stateX)]);
    
    keys.forEach((key: string) => {
        const isEqual: string = (x as any)[key] === (stateX as any)[key] ? '✓' : '✗';
        combinedData.push({
            'xConfig Key': key,
            'xConfig Value': (x as any)[key],
            'xState Key': key,
            'xState Value': (stateX as any)[key],
            'Match': isEqual
        });
    });
    
    console.table(combinedData);
}

export default displayStateAndConfig;