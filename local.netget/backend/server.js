import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import session from 'express-session';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';

const app = express();

app.use(express.json());
app.use(bodyParser.json());
app.use(cookieParser());

const port = process.env.PORT || 3001;
const SECRET_KEY = 'fiij3oi4jris09dakp*koskff';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logFilePath = path.join(__dirname, 'server.log');
const DB_PATH = "/opt/.get/domains.db";

const route = "http://localhost:5173";

// Logging middleware
app.use((req, res, next) => {
  const log = `${new Date().toISOString()} - ${req.method} ${req.url}\n`;
  fs.appendFile(logFilePath, log, (err) => {
    if (err) console.error('Error writing to log file', err);
  });
  next();
});

app.use(
  cors({
    origin: route,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type"]
  })
);

const verifyToken = (req, res, next) => {
  const token = req.cookies.token || req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Acceso no autorizado" });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
      if (err) return res.status(403).json({ message: "Token inválido" });
      req.user = user;
      next();
  });
};

app.options("*", (req, res) => {
  res.header("Access-Control-Allow-Origin", route);
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(200);
});

const users = [{ username: "admin", password: "1234", role: "admin" }, { username: "bren", password: "1234", role: "user" }];

// Configurar la sesión
app.use(
  session({
      secret: "your_secret_key",
      resave: false,
      saveUninitialized: false,
      cookie: {
          httpOnly: true,
          secure: false,
          samesite: "lax",
          maxAge: 30000,
      }
  })
);

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  const user = users.find((u) => u.username === username && u.password === password);

  if (user) {
      const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: "1h" });
      res.cookie("token", token, { httpOnly: true, sameSite: "Strict" });
      return res.json({ success: true });
  }
  return res.status(401).json({ success: false, message: "Usuario o contraseña incorrectos" });
});

// Endpoint para obtener dominios desde la base de datos
app.get("/domains", (req, res) => {
  const Domain = mongoose.model('Domain', new mongoose.Schema({
    domain: String,
    email: String,
    sslMode: String,
    target: String,
    type: String,
    projectPath: String,
    owner: String,
  }));

  Domain.find({}, (err, domains) => {
    if (err) {
      console.error("Error al obtener los dominios:", err.message);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
    res.json(domains);
  });
});


app.put("/update-domain", (req, res) => {
  const { domain, updatedFields } = req.body;

  if (!domain || !updatedFields) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const Domain = mongoose.model('Domain', new mongoose.Schema({
    domain: String,
    email: String,
    sslMode: String,
    target: String,
    type: String,
    projectPath: String,
    owner: String,
  }));

  Domain.findOneAndUpdate({ domain }, updatedFields, { new: true }, (err, updatedDomain) => {
    if (err) {
      console.error("Error updating domain:", err.message);
      return res.status(500).json({ error: "Database update failed" });
    }
    res.json({ success: true, message: "Domain updated successfully", updatedDomain });
  });
});

app.post("/logout", (req, res) => {
  res.clearCookie("token", { httpOnly: true, sameSite: "Strict" }); // Clear authentication cookie
  req.session.destroy(); // Si usas sesiones
  res.json({ success: true, message: "Logged out successfully" });
});

// Rutas protegidas
app.post('/update-db', verifyToken, (req, res) => {
  // Lógica para modificar la base de datos
  res.json({ message: 'Base de datos actualizada' });
});

// Initiate server
app.listen(port, () => {
  console.log(`Server running at ${route}:${port}`);
});