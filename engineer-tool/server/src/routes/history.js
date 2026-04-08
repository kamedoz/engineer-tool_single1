import { Router } from "express";
import { getDb } from "../db.js";
import { getDisplayName } from "../utils/users.js";

const r = Router();

r.get("/", async (_req, res) => {
  const db = getDb();
  try {
    const q = await db.query(
      `SELECT a.id, a.actor_user_id, a.action, a.entity_type, a.entity_id, a.summary, a.details, a.created_at,
              u.first_name, u.last_name, u.email
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_user_id
       ORDER BY a.created_at DESC
       LIMIT 200`
    );
    return res.json({
      entries: (q.rows || []).map((row) => ({
        ...row,
        actor_name: row.actor_user_id ? getDisplayName(row) : "System",
      })),
    });
  } catch (e) {
    console.error("HISTORY GET ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

export default r;
