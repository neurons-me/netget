import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import session from 'express-session';
import sqlite3 from 'sqlite3';
import mongoose from 'mongoose';
import cleaker from 'cleaker';
import dotenvFlow from 'dotenv-flow';
import chalk from 'chalk';

dotenvFlow.config();

const checkEnvVariables = (requiredVars) => { // Centralized environment variable checker
  const missingVars = requiredVars.filter((envVar) => !process.env[envVar]);
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);}};
// Check required environment variables
try { checkEnvVariables(['JWT_SECRET', 'ENCRYPTION_SECRET']);
      console.log(chalk.green('Environment variables validated successfully.'));
} catch (error) {
  console.error(chalk.red(error.message));
  process.exit(1); } // Exit the process if critical variables are missing

const app = express();
const PORT = process.env.PORT || 3000;
const route = "https://api.netget.site";
const SECRET_KEY = "Fjovkmod89f*fo(&%/5hj";
const users = [{ username: "admin", password: "orwell1984", role: "admin" }, { username: "bren", password: "orwell1984", role: "user" }];
const allowedOrigins = ["http://localhost:5173", "https://www.netget.site", "http://34.28.109.244"];
const db = new sqlite3.Database("/opt/.get/domains.db", sqlite3.OPEN_READWRITE, (err) => {
  if (err) {
    console.error("Error al conectar a SQLite:", err.message);
  } else {
    console.log("Conectado a SQLite correctamente");
  }
});

app.use(cookieParser());
app.use(bodyParser.json());
app.use(
    cors({
        origin: function (origin, callback) {
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error("Not allowed by CORS"));
            }
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE"],
        allowedHeaders: "Content-Type, Authorization"
    })
);
// Configure the session middleware
app.use(
    session({
        secret: SECRET_KEY,
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

// Cleaker Middleware Configuration
app.use(
    cleaker.me({
      ledger: 'http://api.cleaker.me/ledger', // Replace with your ledger URL
      blockchain: null, // Full decentralized network
      jwtCookieName: 'cleakerToken', // Name of the JWT cookie
      requireAuth: true, // Enforce authentication globally
    })
  );

app.options("*", (req, res) => {
    res.header("Access-Control-Allow-Origin", route);
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.sendStatus(200);
});

const MONGO_URI = `mongodb://${process.env.MONGO_USER}:${process.env.MONGO_PASSWORD}@${process.env.MONGO_HOST}:${process.env.MONGO_PORT}/${process.env.MONGO_DB}`;
// Connect to MongoDB
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("MongoDB connected!"))
.catch((err) => {
  console.error("MongoDB connection error:", err);
  process.exit(1);
});

// Middleware to verify the cookie
function verifyCookie(req, res, next) {
    const token = req.cookies.token;

    if (!token) {
        return res.status(401).json({ error: "Access denied. No token provided." });
    }

    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(400).json({ error: "Invalid token." });
    }
}

app.get("/healthcheck", (req, res) => {
    res.status(200).send("Server is online");
  });

app.get("/check-auth", (req, res) => {
    if (!req.cookies.token) {
        return res.json({ authenticated: false });
    }

    try {
        const decoded = jwt.verify(req.cookies.token, SECRET_KEY);
        res.json({ authenticated: true, user: decoded });
    } catch (error) {
        res.json({ authenticated: false });
    }
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;

    const user = users.find((u) => u.username === username && u.password === password);

    if (user) {
        const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: "1h" });
        res.cookie("token", token, { httpOnly: true, secure: true, sameSite: "None" });
        return res.json({ success: true });
    }
    return res.status(401).json({ success: false, message: "Usuario o contraseña incorrectos" });
});

// Endpoint para obtener dominios desde la base de datos
app.get("/domains", verifyCookie, async (req, res) => {
    const query = "SELECT domain, email, sslMode, target, type, projectPath, owner FROM domains";

    try {
        // Fetch domains directly from the database
        db.all(query, [], (err, rows) => {
            if (err) {
                console.error("Error al obtener los dominios de la base de datos:", err.message);
                return res.status(500).json({ error: "Error al obtener los dominios de la base de datos" });
            }
            return res.json(rows);
        });
    } catch (error) {
        console.error("Error general al obtener los dominios:", error.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

app.put("/update-domain", verifyCookie, (req, res) => {
    const { domain, updatedFields } = req.body;

    if (!domain || !updatedFields) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    const updates = Object.keys(updatedFields)
        .map((field) => `${field} = ?`)
        .join(", ");
    const values = [...Object.values(updatedFields), domain];

    const query = `UPDATE domains SET ${updates} WHERE domain = ?`;

    db.run(query, values, function (err) {
        if (err) {
            console.error("Error updating domain:", err.message);
            return res.status(500).json({ error: "Database update failed" });
        }

        res.json({ success: true, message: "Domain updated successfully" });
    });
});

app.post("/logout", (req, res) => {
    res.clearCookie("token", {
        httpOnly: true,
        secure: true, // Must match how the cookie was originally set
        sameSite: "None"
    });
    return res.json({ success: true, message: "Logged out successfully" });
});

app.get('/test', (req, res) => {
    if (!req.cleaker || !req.cleaker.identity) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    const identity = req.cleaker.identity;
    const context = req.cleaker.context;
    res.json({ 
        message: "Test endpoint",
        identity,
        context
    });
}
);

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running in port ${PORT} associated with the domain ${route}`);
});
