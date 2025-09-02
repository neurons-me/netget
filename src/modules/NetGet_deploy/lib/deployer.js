import fs from 'fs/promises';
import axios from 'axios';
import { validateDeployConfig } from './validateConfig.js';

export async function performDeploy() {
  try {
    // 1. Leer archivo
    const fileContent = await fs.readFile('./deploy.config.json', 'utf8');
    const config = JSON.parse(fileContent);

    // 2. Validar estructura
    const { isValid, errors } = validateDeployConfig(config);
    if (!isValid) {
      return {
        success: false,
        error: "❌ Errores en el archivo config:\n" + errors.join('\n')
      };
    }

    // 3. Solicitar firma a NetGet
    const dataString = JSON.stringify(config);
    const netgetSignatureResponse = await axios.post('http://localhost:3000/deploy/signature', {
      data: dataString
    });

    const { signature } = netgetSignatureResponse.data;

    if (!signature) {
      return {
        success: false,
        error: 'NetGet no retornó una firma válida.'
      };
    }

    // 4. Enviar a Netget para deploy
    const netgetResponse = await axios.post('http://localhost:3000/deploy', {
      data: dataString,
      signature
    });

    return {
      success: true,
      response: netgetResponse.data
    };

  } catch (err) {
    return {
      success: false,
      error: err.response?.data?.error || err.message
    };
  }
}
