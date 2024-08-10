// src/netget.js
import Gateway from './Gateway.js';
/**
 * Example:
 * const netget = new NetGet();
 * const gateway = netget.Gateway({ host: 'localhost', port: 3000 });
 * gateway.listen();
 */
class NetGet {
  /**
   * Constructs the NetGet service, initializing any necessary base configurations.
   * @constructor
   * @param {Object} config - The configuration object for the NetGet service.
   */
  constructor() {
    // Initialization code, if necessary
  }
  /**
   * Creates a Gateway instance with specified configuration.
   * @param {Object} config - Configuration options for the Gateway.
   * @returns {Gateway} An instance of the Gateway configured with the provided options.
   */
  Gateway(config) {
    const gateway = new Gateway(config);
    return gateway;
  }
  /**
   * Loads and parses the domain configuration from a specified file.
   * @param {string} domainConfigPath - The path to the domain configuration file.
   * @returns {Object|null} The parsed domain configuration object or null if an error occurs.
   */
  static loadDomainConfig(domainConfigPath) {
    try {
      const data = fs.readFileSync(domainConfigPath, 'utf8');
      const domainConfig = JSON.parse(data);
      console.log('Loaded Domain Configuration:', domainConfig);
      return domainConfig;
    } catch (err) {
      console.error('Error loading domain configuration:', err);
      return null;
    }
  }
}
export default NetGet;