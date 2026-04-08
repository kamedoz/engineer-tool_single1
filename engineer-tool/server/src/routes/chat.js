import express from "express";
import { getDb } from "../db.js";
import { uid } from "../utils/uid.js";
import { getDisplayName, getUserLevel } from "../utils/users.js";
import { createAuditLog, createNotification } from "../utils/activity.js";

const router = express.Router();

function mapMessage(row) {
  return {
    id: row.id,
    from_user_id: row.from_user_id,
    to_user_id: row.to_user_id,
    channel: row.channel,
    text: row.deleted_at ? "[message deleted]" : row.text,
    is_deleted: Boolean(row.deleted_at),
    updated_at: row.updated_at,
    created_at: row.created_at,
    quoted_article: row.quoted_article_id
      ? {
          id: row.quoted_article_id,
          title: row.quoted_article_title,
          category: row.quoted_article_category,
          excerpt: row.quoted_article_excerpt,
        }
      : null,
    sender: {
      id: row.sender_id,
      display_name: getDisplayName(row),
      avatar_url: row.avatar_url || "",
      nickname_color: row.nickname_color || "",
      badge_icon: row.badge_icon || "",
      level: getUserLevel(row.experience),
      role: row.sender_role || "",
    },
  };
}

async function getActor(db, userId) {
  const q = await db.query(`SELECT * FROM users WHERE id=$1`, [userId]);
  return q.rows?.[0] || null;
}

function baseMessageQuery() {
  return `
    SELECT
      m.id, m.from_user_id, m.to_user_id, m.channel, m.text,
      m.quoted_article_id, m.quoted_article_title, m.quoted_article_category, m.quoted_article_excerpt,
      m.updated_at, m.deleted_at, m.created_at,
      u.id AS sender_id, u.first_name, u.last_name, u.email, u.avatar_url, u.nickname_color,
      u.badge_icon, u.experience, u.role AS sender_role
    FROM chat_messages m
    LEFT JOIN users u ON u.id = m.from_user_id
  `;
}

router.get("/threads", async (req, res) => {
  const db = getDb();
  const me = req.user?.id;
  if (!me) return res.status(401).json({ error: "Missing token" });

  try {
    const q = await db.query(
      `
      WITH pairs AS (
        SELECT
          CASE WHEN from_user_id = $1 THEN to_user_id ELSE from_user_id END AS other_user_id,
          created_at
        FROM chat_messages
        WHERE channel = 'direct'
          AND deleted_at IS NULL
          AND (from_user_id = $1 OR to_user_id = $1)
      )
      SELECT p.other_user_id, MAX(p.created_at) AS last_at,
             u.email AS other_email, u.first_name, u.last_name, u.avatar_url, u.nickname_color,
             u.badge_icon, u.experience, u.role
      FROM pairs p
      LEFT JOIN users u ON u.id = p.other_user_id
      GROUP BY p.other_user_id, u.email, u.first_name, u.last_name, u.avatar_url, u.nickname_color,
               u.badge_icon, u.experience, u.role
      ORDER BY MAX(p.created_at) DESC
      LIMIT 200
      `,
      [me]
    );

    const threads = (q.rows || []).map((r) => ({
      other_user_id: r.other_user_id,
      other_email: r.other_email,
      name: getDisplayName(r),
      avatar_url: r.avatar_url || "",
      nickname_color: r.nickname_color || "",
      badge_icon: r.badge_icon || "",
      level: getUserLevel(r.experience),
      role: r.role || "",
      last_at: r.last_at,
    }));

    return res.json({ threads });
  } catch (e) {
    console.error("CHAT THREADS ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

router.get("/global", async (_req, res) => {
  const db = getDb();
  try {
    const q = await db.query(
      `${baseMessageQuery()}
       WHERE m.channel = 'global'
       ORDER BY m.created_at ASC
       LIMIT 500`
    );
    return res.json({ messages: (q.rows || []).map(mapMessage) });
  } catch (e) {
    console.error("CHAT GLOBAL ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

router.post("/global", async (req, res) => {
  const db = getDb();
  const me = req.user?.id;
  const msgText = String(req.body?.text || "").trim();
  const quotedArticleId = String(req.body?.quoted_article_id || "").trim();

  if (!me) return res.status(401).json({ error: "Missing token" });
  if (!msgText && !quotedArticleId) return res.status(400).json({ error: "Empty message" });

  let quotedArticle = null;
  if (quotedArticleId) {
    const q = await db.query(
      `SELECT id, title, category, body FROM wiki_articles WHERE id=$1`,
      [quotedArticleId]
    );
    quotedArticle = q.rows?.[0] || null;
    if (!quotedArticle) return res.status(404).json({ error: "Quoted article not found" });
  }

  const msg = {
    id: uid("m_"),
    from_user_id: me,
    to_user_id: null,
    channel: "global",
    text: msgText,
    quoted_article_id: quotedArticle?.id || null,
    quoted_article_title: quotedArticle?.title || null,
    quoted_article_category: quotedArticle?.category || null,
    quoted_article_excerpt: quotedArticle?.body ? String(quotedArticle.body).slice(0, 220) : null,
    updated_at: null,
    created_at: new Date().toISOString(),
  };

  try {
    await db.query(
      `INSERT INTO chat_messages (
        id, from_user_id, to_user_id, channel, text,
        quoted_article_id, quoted_article_title, quoted_article_category, quoted_article_excerpt,
        updated_at, created_at
      )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        msg.id, msg.from_user_id, msg.to_user_id, msg.channel, msg.text,
        msg.quoted_article_id, msg.quoted_article_title, msg.quoted_article_category, msg.quoted_article_excerpt,
        msg.updated_at, msg.created_at,
      ]
    );
    const created = await db.query(`${baseMessageQuery()} WHERE m.id=$1`, [msg.id]);
    await createAuditLog(db, {
      actorUserId: me,
      action: "chat.global.sent",
      entityType: "chat_message",
      entityId: msg.id,
      summary: "Sent message to global chat",
      details: quotedArticleId ? JSON.stringify({ quoted_article_id: quotedArticleId }) : "",
    });
    return res.json({ message: mapMessage(created.rows?.[0]) });
  } catch (e) {
    console.error("CHAT GLOBAL SEND ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

router.put("/messages/:messageId", async (req, res) => {
  const db = getDb();
  const me = req.user?.id;
  const { messageId } = req.params;
  const text = String(req.body?.text || "").trim();
  if (!me) return res.status(401).json({ error: "Missing token" });
  if (!text) return res.status(400).json({ error: "Empty message" });

  try {
    const actor = await getActor(db, me);
    const current = await db.query(`SELECT * FROM chat_messages WHERE id=$1`, [messageId]);
    const message = current.rows?.[0];
    if (!message) return res.status(404).json({ error: "Message not found" });
    if (message.deleted_at) return res.status(400).json({ error: "Message already deleted" });
    if (message.from_user_id !== me && actor?.role !== "admin") {
      return res.status(403).json({ error: "Cannot edit this message" });
    }

    const updatedAt = new Date().toISOString();
    await db.query(`UPDATE chat_messages SET text=$1, updated_at=$2 WHERE id=$3`, [
      text,
      updatedAt,
      messageId,
    ]);

    const updated = await db.query(`${baseMessageQuery()} WHERE m.id=$1`, [messageId]);
    return res.json({ message: mapMessage(updated.rows?.[0]) });
  } catch (e) {
    console.error("CHAT MESSAGE EDIT ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

router.delete("/messages/:messageId", async (req, res) => {
  const db = getDb();
  const me = req.user?.id;
  const { messageId } = req.params;
  if (!me) return res.status(401).json({ error: "Missing token" });

  try {
    const actor = await getActor(db, me);
    const current = await db.query(`SELECT * FROM chat_messages WHERE id=$1`, [messageId]);
    const message = current.rows?.[0];
    if (!message) return res.status(404).json({ error: "Message not found" });
    if (message.from_user_id !== me && actor?.role !== "admin") {
      return res.status(403).json({ error: "Cannot delete this message" });
    }

    await db.query(`UPDATE chat_messages SET deleted_at=$1 WHERE id=$2`, [
      new Date().toISOString(),
      messageId,
    ]);
    return res.json({ ok: true });
  } catch (e) {
    console.error("CHAT MESSAGE DELETE ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

router.get("/:otherUserId", async (req, res) => {
  const db = getDb();
  const me = req.user?.id;
  const other = req.params.otherUserId;
  if (!me) return res.status(401).json({ error: "Missing token" });
  if (!other) return res.status(400).json({ error: "Missing otherUserId" });

  try {
    const q = await db.query(
      `${baseMessageQuery()}
       WHERE m.channel = 'direct'
         AND ((m.from_user_id = $1 AND m.to_user_id = $2)
           OR (m.from_user_id = $2 AND m.to_user_id = $1))
       ORDER BY m.created_at ASC
       LIMIT 500`,
      [me, other]
    );

    return res.json({ messages: (q.rows || []).map(mapMessage) });
  } catch (e) {
    console.error("CHAT MESSAGES ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

router.post("/:otherUserId", async (req, res) => {
  const db = getDb();
  const me = req.user?.id;
  const other = req.params.otherUserId;
  const msgText = String(req.body?.text || "").trim();
  const quotedArticleId = String(req.body?.quoted_article_id || "").trim();

  if (!me) return res.status(401).json({ error: "Missing token" });
  if (!other) return res.status(400).json({ error: "Missing otherUserId" });
  if (!msgText && !quotedArticleId) return res.status(400).json({ error: "Empty message" });

  let quotedArticle = null;
  if (quotedArticleId) {
    const q = await db.query(
      `SELECT id, title, category, body FROM wiki_articles WHERE id=$1`,
      [quotedArticleId]
    );
    quotedArticle = q.rows?.[0] || null;
    if (!quotedArticle) return res.status(404).json({ error: "Quoted article not found" });
  }

  const msg = {
    id: uid("m_"),
    from_user_id: me,
    to_user_id: other,
    channel: "direct",
    text: msgText,
    quoted_article_id: quotedArticle?.id || null,
    quoted_article_title: quotedArticle?.title || null,
    quoted_article_category: quotedArticle?.category || null,
    quoted_article_excerpt: quotedArticle?.body ? String(quotedArticle.body).slice(0, 220) : null,
    updated_at: null,
    created_at: new Date().toISOString(),
  };

  try {
    await db.query(
      `INSERT INTO chat_messages (
        id, from_user_id, to_user_id, channel, text,
        quoted_article_id, quoted_article_title, quoted_article_category, quoted_article_excerpt,
        updated_at, created_at
      )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        msg.id, msg.from_user_id, msg.to_user_id, msg.channel, msg.text,
        msg.quoted_article_id, msg.quoted_article_title, msg.quoted_article_category, msg.quoted_article_excerpt,
        msg.updated_at, msg.created_at,
      ]
    );
    const created = await db.query(`${baseMessageQuery()} WHERE m.id=$1`, [msg.id]);
    await createAuditLog(db, {
      actorUserId: me,
      action: "chat.direct.sent",
      entityType: "chat_message",
      entityId: msg.id,
      summary: `Sent direct message to ${other}`,
      details: quotedArticleId ? JSON.stringify({ quoted_article_id: quotedArticleId }) : "",
    });
    if (other !== me) {
      await createNotification(db, {
        userId: other,
        type: "direct_message",
        title: "New direct message",
        body: msgText ? msgText.slice(0, 140) : "You received a quoted knowledge article.",
        entityType: "chat_message",
        entityId: msg.id,
      });
    }
    return res.json({ message: mapMessage(created.rows?.[0]) });
  } catch (e) {
    console.error("CHAT SEND ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
