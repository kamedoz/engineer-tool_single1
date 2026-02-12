// server/src/routes/categories.js
import express from "express";
import { getDb } from "../db.js";
import { uid } from "../utils/uid.js";

const router = express.Router();

/**
 * GET /api/categories
 */
router.get("/", async (req, res) => {
  const db = getDb();
  try {
    const q = await db.query(
      `SELECT id, name, owner_user_id, created_at FROM categories ORDER BY name ASC`
    );
    res.json(q.rows || []);
  } catch (e) {
    console.error("CATEGORIES GET ERROR:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

/**
 * POST /api/categories
 * body: { name }
 */
router.post("/", async (req, res) => {
  const db = getDb();
  const { name } = req.body ?? {};
  const n = String(name || "").trim();
  if (!n) return res.status(400).json({ error: "name is required" });

  const now = new Date().toISOString();
  const id = uid("c_");
  const ownerId = req.user?.id || null;

  try {
    await db.query(
      `INSERT INTO categories (id, name, owner_user_id, created_at) VALUES ($1,$2,$3,$4)`,
      [id, n, ownerId, now]
    );
    res.json({ id, name: n, owner_user_id: ownerId, created_at: now });
  } catch (e) {
    console.error("CATEGORIES POST ERROR:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

/**
 * PUT /api/categories/:id
 */
router.put("/:id", async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { name } = req.body ?? {};
  const n = String(name || "").trim();
  if (!n) return res.status(400).json({ error: "name is required" });

  try {
    const u = await db.query(`UPDATE categories SET name=$1 WHERE id=$2`, [n, id]);
    if (!u.rowCount) return res.status(404).json({ error: "not found" });

    const q = await db.query(
      `SELECT id, name, owner_user_id, created_at FROM categories WHERE id=$1`,
      [id]
    );
    res.json(q.rows?.[0] || null);
  } catch (e) {
    console.error("CATEGORIES PUT ERROR:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

/**
 * DELETE /api/categories/:id
 */
router.delete("/:id", async (req, res) => {
  const db = getDb();
  const { id } = req.params;

  try {
    const d = await db.query(`DELETE FROM categories WHERE id=$1`, [id]);
    if (!d.rowCount) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  } catch (e) {
    console.error("CATEGORIES DELETE ERROR:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;

