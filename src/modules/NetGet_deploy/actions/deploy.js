import { performDeploy } from '../lib/deployer.js';

export async function run() {
  console.log("🚀 Iniciando proceso de despliegue...");

  const result = await performDeploy();

  if (result.success) {
    console.log("✅ Despliegue exitoso");
  } else {
    console.error("❌ Error en despliegue:", result.error);
  }
}
