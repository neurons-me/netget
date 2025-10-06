// src/netget.ts

interface NetGetConfig {
    [key: string]: any;
}

class NetGet {
    private config?: NetGetConfig;

    /**
     * Constructs the NetGet service, initializing any necessary base configurations.
     * @constructor
     * @param config - The configuration object for the NetGet service.
     */
    constructor(config?: NetGetConfig) {
        this.config = config;
        // Initialization code, if necessary
    }

    /**
     * Gets the current configuration
     * @returns The current configuration object
     */
    getConfig(): NetGetConfig | undefined {
        return this.config;
    }

    /**
     * Updates the configuration
     * @param newConfig - New configuration to merge
     */
    updateConfig(newConfig: Partial<NetGetConfig>): void {
        this.config = { ...this.config, ...newConfig };
    }
}

export default NetGet;
export type { NetGetConfig };