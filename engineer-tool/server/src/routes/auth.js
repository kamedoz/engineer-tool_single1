import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { getDb } from "../db.js";
import { uid } from "../utils/uid.js";

const router = express.Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET || "dev_secret",
    { expiresIn: "7d" }
  );
}

async function handleRegister(req, res) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const { email, password, first_name, last_name } = parsed.data;
  const db = getDb();

  try {
    const existing = await db.query("SELECT id FROM users WHERE email=$1", [email]);
    if (existing.rows?.[0]) {
      return res.status(409).json({ error: "User already exists" });
    }

    const id = uid("u_");
    const now = new Date().toISOString();
    const role = "engineer";
    const passwordHash = bcrypt.hashSync(password, 10);

    await db.query(
      `INSERT INTO users (id,email,password_hash,first_name,last_name,role,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, email, passwordHash, first_name, last_name, role, now]
    );

    const token = signToken({ id, email, role });

    return res.json({
      token,
      user: { id, email, first_name, last_name, role },
    });
  } catch (e) {
    // Postgres unique violation
    if (String(e?.code) === "23505") {
      return res.status(409).json({ error: "User already exists" });
    }
    console.error("REGISTER ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
}

router.post("/register", handleRegister);
router.post("/signup", handleRegister);

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const { email, password } = parsed.data;
  const db = getDb();

  try {
    const q = await db.query("SELECT * FROM users WHERE email=$1", [email]);
    const user = q.rows?.[0];
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const ok = bcrypt.compareSync(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = signToken({ id: user.id, email: user.email, role: user.role });

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
      },
    });
  } catch (e) {
    console.error("LOGIN ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
