import { Router } from "express";
import { getDb } from "../db.js";

const r = Router();

r.get("/me", async (req, res) => {
  const db = getDb();
  try {
    const q = await db.query(
      "SELECT id,email,first_name,last_name,role,created_at FROM users WHERE id=$1",
      [req.user.id]
    );
    return res.json({ user: q.rows?.[0] || null });
  } catch (e) {
    console.error("USERS /me ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

r.get("/", async (req, res) => {
  const db = getDb();
  try {
    const q = await db.query(
      "SELECT id,email,first_name,last_name,role FROM users ORDER BY created_at DESC"
    );
    return res.json({ users: q.rows || [] });
  } catch (e) {
    console.error("USERS / ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

export default r;
