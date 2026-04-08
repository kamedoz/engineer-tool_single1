import { Router } from "express";
import { getDb } from "../db.js";

const r = Router();

r.get("/", async (req, res) => {
  const db = getDb();
  try {
    const q = await db.query(
      `SELECT id, user_id, type, title, body, entity_type, entity_id, is_read, created_at
       FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [req.user.id]
    );
    return res.json({ notifications: q.rows || [] });
  } catch (e) {
    console.error("NOTIFICATIONS GET ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

r.put("/:id/read", async (req, res) => {
  const db = getDb();
  try {
    await db.query(`UPDATE notifications SET is_read=TRUE WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
    return res.json({ ok: true });
  } catch (e) {
    console.error("NOTIFICATIONS READ ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

r.put("/read-all", async (req, res) => {
  const db = getDb();
  try {
    await db.query(`UPDATE notifications SET is_read=TRUE WHERE user_id=$1 AND is_read=FALSE`, [req.user.id]);
    return res.json({ ok: true });
  } catch (e) {
    console.error("NOTIFICATIONS READ ALL ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

export default r;
