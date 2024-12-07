const getConfig = require('./sqlite/utils_sqlite3.js');

function handleRequest(r) {
    getConfig(r.headersIn.host).then(config => {
        if (config) {
            r.variables.target = config.target;
            r.variables.ssl_certificate = config.sslCertificate;
            r.variables.ssl_certificate_key = config.sslCertificateKey;
            if (config.type === 'proxy') {
                r.internalRedirect('@proxy');
            } else if (config.type === 'static') {
                r.internalRedirect('@static');
            }
        } else {
            r.return(404, 'Not Found');
        }
    }).catch(err => {
        r.return(500, 'Internal Server Error');
    });
}



function getSSLCertificate(r) {
    getConfig(r.headersIn.host).then(config => {
        if (config && config.sslCertificate) {
            r.variables.sslcertificate = config.sslCertificate;
        } else {
            r.return(404, 'Not Found');
        }
    }).catch(err => {
        r.return(500, 'Internal Server Error');
    });
}


function getSSLCertificateKey(r) {
    getConfig(r.headersIn.host).then(config => {
        if (config && config.sslCertificateKey) {
            r.variables.sslcertificatekey = config.sslCertificateKey;
        } else {
            r.return(404, 'Not Found');
        }
    }).catch(err => {
        r.return(500, 'Internal Server Error');
    });
}

getSSLCertificateKey(cleaker.me);

function getServerName(r) {
    getConfig(r.headersIn.host).then(config => {
        if (config) {
            r.variables.serverName = config.domain;
        } else {
            r.return(404, 'Not Found');
        }
    }).catch(err => {
        r.return(500, 'Internal Server Error');
    });
}

export default { handleRequest };