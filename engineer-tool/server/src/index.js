import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { initDb, getDb } from "./db.js";
import { uid } from "./utils/uid.js";
import { authRequired } from "./middleware/auth.js";

import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import categoryRoutes from "./routes/categories.js";
import issueRoutes from "./routes/issues.js";
import ticketRoutes from "./routes/tickets.js";
import chatRoutes from "./routes/chat.js";

dotenv.config();

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const app = express();

// ✅ FIX 1: отключаем ETag, чтобы API не возвращал 304 Not Modified
app.set("etag", false);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));

// ✅ FIX 2: запрещаем кеширование для API
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
  }
  next();
});

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;

  const db = getDb();
  const existingQ = await db.query(
    `SELECT id,email,role FROM users WHERE email=$1`,
    [email]
  );
  const existing = existingQ.rows?.[0];

  if (!existing) {
    const now = new Date().toISOString();
    const id = uid("u_");
    const hash = bcrypt.hashSync(password, 10);
    await db.query(
      `INSERT INTO users (id,email,password_hash,first_name,last_name,role,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, email, hash, "Admin", "User", "admin", now]
    );
    console.log("Seeded admin user:", email);
  } else {
    if (existing.role !== "admin") {
      await db.query(`UPDATE users SET role='admin' WHERE email=$1`, [email]);
      console.log("Updated user role to admin:", email);
    } else {
      console.log("Admin user exists:", email);
    }
  }
}

// bootstrap
async function bootstrap() {
  await initDb();
  await seedAdmin();

  const port = process.env.PORT || 4000;
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/users", authRequired, userRoutes);
app.use("/api/categories", authRequired, categoryRoutes);
app.use("/api/issues", authRequired, issueRoutes);
app.use("/api/tickets", authRequired, ticketRoutes);
app.use("/api/chat", authRequired, chatRoutes);



// Serve built frontend (single-service deployment)
const clientDist = path.join(__dirname, "..", "..", "client", "dist");
app.use(express.static(clientDist));

// SPA fallback (React Router)
app.get("*", (req, res) => {
  // Don't hijack API routes
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(clientDist, "index.html"));
});

bootstrap().catch((e) => {
  console.error("BOOTSTRAP ERROR:", e);
  process.exit(1);
});
