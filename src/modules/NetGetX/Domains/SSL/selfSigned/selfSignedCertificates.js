import fs from 'fs';
import path from 'path';
import { generateSelfSignedCert } from './certGenerator'; // Assuming you have a module to generate certificates
import { saveXConfig } from '../../../config/xConfig';
const checkExistingCertificates = (certPath) => {
    return fs.existsSync(certPath);
};

const generateSelfSignedCertificates = async (certPath) => {
    console.log(chalk.green('Generating Self-Signed SSL Certificates...'));
    const { certPath: generatedCertPath, keyPath } = await generateSelfSignedCert(certPath);
    console.log(chalk.green('Self-Signed SSL Certificates generated.'));
    return { generatedCertPath, keyPath };
};

const selfSignedMethod = async (xConfig) => {
    console.log(chalk.green('Setting up Self-Signed SSL...'));
    const certPath = path.join(__dirname, 'certs', 'selfsigned.crt');
    
    if (!checkExistingCertificates(certPath)) {
        const { generatedCertPath, keyPath } = await generateSelfSignedCertificates(certPath);
        xConfig.sslCertPath = generatedCertPath;
        xConfig.sslKeyPath = keyPath;
        await saveXConfig(xConfig);
    } else {
        console.log(chalk.green('Existing Self-Signed SSL Certificates found.'));
    }
};

export { selfSignedMethod };