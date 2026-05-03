// netget/src/modules/NetGetX/config/x_StateAndConfig.ts
import chalk from 'chalk';
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
    console.log(chalk.cyan('Developer diagnostics: xConfig vs xState'));
    console.log(chalk.gray([
        'Purpose:',
        '  xConfig is the saved configuration on disk (~/.get/xConfig.json).',
        '  xState is the in-memory copy used by this running CLI session.',
        '',
        'How to read it:',
        '  ✓ means the saved value and the live value match.',
        '  ✗ means the CLI memory differs from the saved file; this can happen after edits, failed setup, or stale state.',
        '',
        'What to do:',
        '  If everything is ✓, there is nothing to fix.',
        '  If a key is ✗, restart NetGet or re-run the related setup screen to resync it.',
        '',
    ].join('\n')));
    
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
    const mismatches = combinedData.filter((item) => item.Match !== '✓');
    if (mismatches.length === 0) {
        console.log(chalk.green('\nAll config keys match. The saved config and live CLI state are in sync.'));
    } else {
        console.log(chalk.yellow(`\n${mismatches.length} key(s) differ. Review the rows marked ✗ above.`));
    }
}

export default displayStateAndConfig;
