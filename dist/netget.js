class NetGet {
    config;
    /**
     * Constructs the NetGet service, initializing any necessary base configurations.
     * @constructor
     * @param config - The configuration object for the NetGet service.
     */
    constructor(config) {
        this.config = config;
        // Initialization code, if necessary
    }
    /**
     * Gets the current configuration
     * @returns The current configuration object
     */
    getConfig() {
        return this.config;
    }
    /**
     * Updates the configuration
     * @param newConfig - New configuration to merge
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }
}
export default NetGet;
