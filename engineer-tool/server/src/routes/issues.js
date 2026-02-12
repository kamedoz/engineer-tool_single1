// server/src/routes/issues.js
import express from "express";
import { getDb } from "../db.js";
import { uid } from "../utils/uid.js";

const router = express.Router();

/**
 * GET /api/issues?category_id=...
 */
router.get("/", async (req, res) => {
  const db = getDb();
  const { category_id } = req.query;
  try {
    if (category_id) {
      const q = await db.query(
        `SELECT i.id, i.category_id, c.name AS category_name, i.title, i.description, i.created_at
         FROM issues i
         LEFT JOIN categories c ON c.id = i.category_id
         WHERE i.category_id=$1
         ORDER BY i.created_at DESC`,
        [String(category_id)]
      );
      return res.json(q.rows || []);
    }

    const q = await db.query(
      `SELECT i.id, i.category_id, c.name AS category_name, i.title, i.description, i.created_at
       FROM issues i
       LEFT JOIN categories c ON c.id = i.category_id
       ORDER BY i.created_at DESC`
    );
    return res.json(q.rows || []);
  } catch (e) {
    console.error("ISSUES GET ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

/**
 * POST /api/issues
 * body: { category_id, title, description? }
 */
router.post("/", async (req, res) => {
  const db = getDb();
  const { category_id, title, description } = req.body ?? {};

  const cid = String(category_id || "").trim();
  const t = String(title || "").trim();
  const d = description == null ? null : String(description);

  if (!cid) return res.status(400).json({ error: "category_id is required" });
  if (!t) return res.status(400).json({ error: "title is required" });

  const now = new Date().toISOString();
  const id = uid("i_");

  try {
    await db.query(
      `INSERT INTO issues (id, category_id, title, description, created_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, cid, t, d, now]
    );
    return res.json({ id, category_id: cid, title: t, description: d, created_at: now });
  } catch (e) {
    console.error("ISSUES POST ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

/**
 * PUT /api/issues/:id
 */
router.put("/:id", async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { category_id, title, description } = req.body ?? {};

  const cid = category_id == null ? null : String(category_id).trim();
  const t = title == null ? null : String(title).trim();
  const d = description == null ? null : String(description);

  try {
    const cur = await db.query(
      `SELECT id, category_id, title, description, created_at FROM issues WHERE id=$1`,
      [id]
    );
    const current = cur.rows?.[0];
    if (!current) return res.status(404).json({ error: "not found" });

    const next = {
      category_id: cid ?? current.category_id,
      title: t ?? current.title,
      description: d ?? current.description,
    };

    if (!next.category_id) return res.status(400).json({ error: "category_id is required" });
    if (!next.title) return res.status(400).json({ error: "title is required" });

    await db.query(
      `UPDATE issues SET category_id=$1, title=$2, description=$3 WHERE id=$4`,
      [next.category_id, next.title, next.description, id]
    );

    const q = await db.query(
      `SELECT id, category_id, title, description, created_at FROM issues WHERE id=$1`,
      [id]
    );
    return res.json(q.rows?.[0] || null);
  } catch (e) {
    console.error("ISSUES PUT ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

/**
 * DELETE /api/issues/:id
 */
router.delete("/:id", async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  try {
    const d = await db.query(`DELETE FROM issues WHERE id=$1`, [id]);
    if (!d.rowCount) return res.status(404).json({ error: "not found" });
    return res.json({ ok: true });
  } catch (e) {
    console.error("ISSUES DELETE ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
