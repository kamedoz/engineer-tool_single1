// server/src/routes/wiki.js
import express from "express";
import { getDb } from "../db.js";
import { uid } from "../utils/uid.js";

const router = express.Router();

/**
 * GET /api/wiki?category=...&search=...
 */
router.get("/", async (req, res) => {
  const db = getDb();
  const { category, search } = req.query;
  try {
    let q = `SELECT id, title, category, body, images, created_by_user_id, created_at, updated_at FROM wiki_articles`;
    const params = [];
    const conditions = [];

    if (category) {
      params.push(String(category));
      conditions.push(`LOWER(category) = LOWER($${params.length})`);
    }
    if (search) {
      params.push(`%${String(search).toLowerCase()}%`);
      conditions.push(`(LOWER(title) LIKE $${params.length} OR LOWER(body) LIKE $${params.length} OR LOWER(category) LIKE $${params.length})`);
    }
    if (conditions.length) q += ` WHERE ` + conditions.join(" AND ");
    q += ` ORDER BY updated_at DESC`;

    const result = await db.query(q, params);
    return res.json(result.rows || []);
  } catch (e) {
    console.error("WIKI GET ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

/**
 * GET /api/wiki/categories — список уникальных категорий
 */
router.get("/categories", async (req, res) => {
  const db = getDb();
  try {
    const result = await db.query(
      `SELECT DISTINCT category FROM wiki_articles WHERE category IS NOT NULL AND category != '' ORDER BY category`
    );
    return res.json(result.rows.map((r) => r.category));
  } catch (e) {
    console.error("WIKI CATEGORIES ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

/**
 * GET /api/wiki/:id
 */
router.get("/:id", async (req, res) => {
  const db = getDb();
  try {
    const result = await db.query(
      `SELECT id, title, category, body, images, created_by_user_id, created_at, updated_at FROM wiki_articles WHERE id=$1`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "not found" });
    return res.json(result.rows[0]);
  } catch (e) {
    return res.status(500).json({ error: "Internal error" });
  }
});

/**
 * POST /api/wiki
 * body: { title, category, body, images? }
 */
router.post("/", async (req, res) => {
  const db = getDb();
  const { title, category, body, images } = req.body ?? {};
  const t = String(title || "").trim();
  const cat = String(category || "").trim();
  const b = String(body || "");
  const imgs = Array.isArray(images) ? images : [];

  if (!t) return res.status(400).json({ error: "title is required" });
  if (!cat) return res.status(400).json({ error: "category is required" });

  const now = new Date().toISOString();
  const id = uid("w_");

  try {
    await db.query(
      `INSERT INTO wiki_articles (id, title, category, body, images, created_by_user_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, t, cat, b, JSON.stringify(imgs), req.user?.id || null, now, now]
    );
    return res.json({ id, title: t, category: cat, body: b, images: imgs, created_at: now, updated_at: now });
  } catch (e) {
    console.error("WIKI POST ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

/**
 * PUT /api/wiki/:id
 */
router.put("/:id", async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { title, category, body, images } = req.body ?? {};

  try {
    const cur = await db.query(`SELECT * FROM wiki_articles WHERE id=$1`, [id]);
    const current = cur.rows?.[0];
    if (!current) return res.status(404).json({ error: "not found" });

    const next = {
      title: title != null ? String(title).trim() : current.title,
      category: category != null ? String(category).trim() : current.category,
      body: body != null ? String(body) : current.body,
      images: images != null ? (Array.isArray(images) ? images : []) : (current.images ? JSON.parse(current.images) : []),
    };

    if (!next.title) return res.status(400).json({ error: "title is required" });
    if (!next.category) return res.status(400).json({ error: "category is required" });

    const now = new Date().toISOString();
    await db.query(
      `UPDATE wiki_articles SET title=$1, category=$2, body=$3, images=$4, updated_at=$5 WHERE id=$6`,
      [next.title, next.category, next.body, JSON.stringify(next.images), now, id]
    );

    return res.json({ id, ...next, updated_at: now });
  } catch (e) {
    console.error("WIKI PUT ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

/**
 * DELETE /api/wiki/:id
 */
router.delete("/:id", async (req, res) => {
  const db = getDb();
  try {
    const d = await db.query(`DELETE FROM wiki_articles WHERE id=$1`, [req.params.id]);
    if (!d.rowCount) return res.status(404).json({ error: "not found" });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
