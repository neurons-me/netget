
// === CLI TOOL (Node.js) ===
// File: netget-deploy.js
import fs from 'fs';
import axios from 'axios';
import FormData from 'form-data';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import child_process from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function deploy(configPath) {
  const config = JSON.parse(fs.readFileSync(configPath));
  const { server, apiKey, target } = config;

  // 1. Authenticate
  const authRes = await axios.post(`${server}/deploy/auth`, { apiKey });
  const token = authRes.data.token;

  // 2. Validate domain/port
  await axios.post(`${server}/deploy/validate`, {
    domain: target.domain,
    port: target.port
  }, { headers: { Authorization: `Bearer ${token}` } });

  // 3. Upload code
  const zipPath = path.join(__dirname, 'package.zip');
  child_process.execSync(`zip -r ${zipPath} ${target.source}`);

  const form = new FormData();
  form.append('file', fs.createReadStream(zipPath));

  await axios.post(`${server}/deploy/upload`, form, {
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${token}`
    }
  });

  // 4. Deploy to destination
  const installRes = await axios.post(`${server}/deploy/install`, {
    destination: target.destination,
    startCommand: target.startCommand
  }, { headers: { Authorization: `Bearer ${token}` } });

  console.log('Deploy complete:', installRes.data);
}

// Ejecutar con: node netget-deploy.js deploy.api.json
if (import.meta.url === process.argv[1] || import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error('Usage: node netget-deploy.js <config.json>');
    process.exit(1);
  }
  deploy(args[0]).catch(err => {
    console.error('Deploy failed:', err.message);
    process.exit(1);
  });
}