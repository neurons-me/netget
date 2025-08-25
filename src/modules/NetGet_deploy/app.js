import express from "express";
import pkg from "body-parser";
const { json } = pkg;
import verifyRoute from "./verify.js";
import crypto from "crypto";
import fs from "fs";

const app = express();
app.use(json());

app.get("/", (req, res) => {
    res.send("Netget server is running");
});

// Ruta para generar y devolver la firma del body recibido
app.post("/signature", (req, res) => {
        const secret = fs.readFileSync("./privkey.pem", "utf8");
        const user_id = "netget-client-123";
        const timestamp = Date.now();
        const payload = {
                ...req.body,
                user_id,
                timestamp
        };

        const data = JSON.stringify(payload);
        const signature = crypto
                .createSign("sha256", secret)
                .update(JSON.stringify(payload))
                .end();

        const signatureBase64 = signature.sign(secret, "base64");
        res.json({ signature: signatureBase64, data });
});

app.use(verifyRoute);

const deployRouter = express.Router();

deployRouter.post('/deploy', async (req, res) => {
        try {
                const config = req.body;

                // 1. Validaciones mínimas
                if (!config.token || !config.routes || !config.server) {
                        return res.status(400).json({ error: 'Faltan campos obligatorios' });
                }

                // 2. Validación del token (ej. contra NetGet o BD local)
                if (config.token !== process.env.DEPLOY_TOKEN) {
                        return res.status(403).json({ error: 'Token inválido' });
                }

                // 3. Simular ejecución del despliegue
                console.log("📦 Recibido para deploy:", config);

                // 4. Si todo va bien
                return res.status(200).json({
                        success: true,
                        message: 'Despliegue ejecutado correctamente',
                        details: {
                                deployedTo: config.server,
                                routes: config.routes.length
                        }
                });

        } catch (err) {
                console.error("❌ Error en deploy:", err.message);
                return res.status(500).json({ error: 'Error interno en el servidor' });
        }
});

app.use(deployRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Netget server on port ${PORT}`));
