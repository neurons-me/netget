interface NetGetConfig {
    [key: string]: any;
}
declare class NetGet {
    private config?;
    /**
     * Constructs the NetGet service, initializing any necessary base configurations.
     * @constructor
     * @param config - The configuration object for the NetGet service.
     */
    constructor(config?: NetGetConfig);
    /**
     * Gets the current configuration
     * @returns The current configuration object
     */
    getConfig(): NetGetConfig | undefined;
    /**
     * Updates the configuration
     * @param newConfig - New configuration to merge
     */
    updateConfig(newConfig: Partial<NetGetConfig>): void;
}
export default NetGet;
export type { NetGetConfig };
//# sourceMappingURL=netget.d.ts.map