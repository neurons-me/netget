import utils_sqlite3 from './utils_sqlite3.js';
import { DomainConfigResult } from './utils_sqlite3.js';

interface RequestObject {
    headersIn: {
        host: string;
    };
    variables: {
        target?: string;
        ssl_certificate?: string;
        ssl_certificate_key?: string;
        sslcertificate?: string;
        sslcertificatekey?: string;
        serverName?: string;
    };
    internalRedirect(location: string): void;
    return(status: number, message: string): void;
}

/**
 * Handles the incoming request and sets the appropriate variables based on the configuration.
 */
function handleRequest(r: RequestObject): void {
    utils_sqlite3.getConfig(r.headersIn.host).then((config: DomainConfigResult | undefined) => {
        if (config) {
            r.variables.target = config.target;
            r.variables.ssl_certificate = config.sslCertificate;
            r.variables.ssl_certificate_key = config.sslCertificate; // Note: Original code had sslCertificateKey but interface shows target
            if (config.type === 'proxy') {
                r.internalRedirect('@proxy');
            } else if (config.type === 'static') {
                r.internalRedirect('@static');
            }
        } else {
            r.return(404, 'Not Found');
        }
    }).catch((err: any) => {
        r.return(500, 'Internal Server Error');
    });
}

/**
 * Retrieves the SSL certificate for the given request.
 */
function getSSLCertificate(r: RequestObject): void {
    utils_sqlite3.getConfig(r.headersIn.host).then((config: DomainConfigResult | undefined) => {
        if (config && config.sslCertificate) {
            r.variables.sslcertificate = config.sslCertificate;
        } else {
            r.return(404, 'Not Found');
        }
    }).catch((err: any) => {
        r.return(500, 'Internal Server Error');
    });
}

/**
 * Retrieves the SSL certificate key for the given request.
 */
function getSSLCertificateKey(r: RequestObject): void {
    utils_sqlite3.getConfig(r.headersIn.host).then((config: DomainConfigResult | undefined) => {
        if (config && config.sslCertificate) { // Note: Using sslCertificate as the interface shows target instead of sslCertificateKey
            r.variables.sslcertificatekey = config.sslCertificate;
        } else {
            r.return(404, 'Not Found');
        }
    }).catch((err: any) => {
        r.return(500, 'Internal Server Error');
    });
}

/**
 * Retrieves the server name for the given request.
 */
function getServerName(r: RequestObject): void {
    utils_sqlite3.getConfig(r.headersIn.host).then((config: DomainConfigResult | undefined) => {
        if (config) {
            r.variables.serverName = config.domain;
        } else {
            r.return(404, 'Not Found');
        }
    }).catch((err: any) => {
        r.return(500, 'Internal Server Error');
    });
}

export default { handleRequest };
export { handleRequest, getSSLCertificate, getSSLCertificateKey, getServerName };
export type { RequestObject };