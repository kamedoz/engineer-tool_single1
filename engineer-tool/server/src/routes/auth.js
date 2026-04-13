import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { getDb } from "../db.js";
import { serializeUser } from "../utils/users.js";

const router = express.Router();

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

router.post("/register", (_req, res) => {
  return res.status(403).json({ error: "Only admins can create new users" });
});
router.post("/signup", (_req, res) => {
  return res.status(403).json({ error: "Only admins can create new users" });
});

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
      user: serializeUser(user),
    });
  } catch (e) {
    console.error("LOGIN ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
