// server/src/routes/chat.js
// Matches client API:
//   GET  /api/chat/threads
//   GET  /api/chat/:otherUserId
//   POST /api/chat/:otherUserId  { text }

import express from "express";
import { getDb } from "../db.js";
import { uid } from "../utils/uid.js";

const router = express.Router();

/**
 * GET /api/chat/threads
 * Returns people you have chatted with, last message time.
 */
router.get("/threads", async (req, res) => {
  const db = getDb();
  const me = req.user?.id;
  if (!me) return res.status(401).json({ error: "Missing token" });

  try {
    // Get distinct counterpart ids from both directions
    const q = await db.query(
      `
      WITH pairs AS (
        SELECT
          CASE WHEN from_user_id = $1 THEN to_user_id ELSE from_user_id END AS other_user_id,
          created_at
        FROM chat_messages
        WHERE from_user_id = $1 OR to_user_id = $1
      )
      SELECT p.other_user_id, MAX(p.created_at) AS last_at,
             u.email AS other_email, u.first_name, u.last_name
      FROM pairs p
      LEFT JOIN users u ON u.id = p.other_user_id
      GROUP BY p.other_user_id, u.email, u.first_name, u.last_name
      ORDER BY MAX(p.created_at) DESC
      LIMIT 200
      `,
      [me]
    );

    const threads = (q.rows || []).map((r) => ({
      other_user_id: r.other_user_id,
      other_email: r.other_email,
      name:
        (r.first_name || r.last_name)
          ? `${r.first_name || ""} ${r.last_name || ""}`.trim()
          : null,
      last_at: r.last_at,
    }));

    return res.json({ threads });
  } catch (e) {
    console.error("CHAT THREADS ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

/**
 * GET /api/chat/:otherUserId
 */
router.get("/:otherUserId", async (req, res) => {
  const db = getDb();
  const me = req.user?.id;
  const other = req.params.otherUserId;
  if (!me) return res.status(401).json({ error: "Missing token" });
  if (!other) return res.status(400).json({ error: "Missing otherUserId" });

  try {
    const q = await db.query(
      `
      SELECT id, from_user_id, to_user_id, text, created_at
      FROM chat_messages
      WHERE (from_user_id = $1 AND to_user_id = $2)
         OR (from_user_id = $2 AND to_user_id = $1)
      ORDER BY created_at ASC
      LIMIT 500
      `,
      [me, other]
    );

    return res.json({ messages: q.rows || [] });
  } catch (e) {
    console.error("CHAT MESSAGES ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

/**
 * POST /api/chat/:otherUserId
 * body: { text }
 */
router.post("/:otherUserId", async (req, res) => {
  const db = getDb();
  const me = req.user?.id;
  const other = req.params.otherUserId;
  const { text } = req.body ?? {};

  if (!me) return res.status(401).json({ error: "Missing token" });
  if (!other) return res.status(400).json({ error: "Missing otherUserId" });
  const msgText = String(text || "").trim();
  if (!msgText) return res.status(400).json({ error: "Empty message" });

  const msg = {
    id: uid("m_"),
    from_user_id: me,
    to_user_id: other,
    text: msgText,
    created_at: new Date().toISOString(),
  };

  try {
    await db.query(
      `INSERT INTO chat_messages (id, from_user_id, to_user_id, text, created_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [msg.id, msg.from_user_id, msg.to_user_id, msg.text, msg.created_at]
    );
    return res.json({ message: msg });
  } catch (e) {
    console.error("CHAT SEND ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
