import express from "express";
import { getDb } from "../db.js";
import { uid } from "../utils/uid.js";
import { XP_PER_ARTICLE, getDisplayName, getUserLevel } from "../utils/users.js";
import { createAuditLog, createNotification } from "../utils/activity.js";

const router = express.Router();

function parseMedia(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeArticle(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    body: row.body,
    images: parseMedia(row.images),
    created_by_user_id: row.created_by_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    author: row.author_id
      ? {
          id: row.author_id,
          display_name: getDisplayName(row),
          avatar_url: row.avatar_url || "",
          nickname_color: row.nickname_color || "",
          badge_icon: row.badge_icon || "",
          level: getUserLevel(row.experience),
          role: row.author_role || "",
        }
      : null,
  };
}

function normalizeComment(row) {
  if (!row) return null;
  return {
    id: row.id,
    article_id: row.article_id,
    user_id: row.user_id,
    body: row.body,
    is_deleted: false,
    created_at: row.created_at,
    updated_at: row.updated_at,
    author: row.comment_author_id
      ? {
          id: row.comment_author_id,
          display_name: getDisplayName(row),
          avatar_url: row.avatar_url || "",
          nickname_color: row.nickname_color || "",
          badge_icon: row.badge_icon || "",
          level: getUserLevel(row.experience),
          role: row.comment_author_role || "",
        }
      : null,
  };
}

async function getActor(db, userId) {
  if (!userId) return null;
  const q = await db.query(`SELECT * FROM users WHERE id=$1`, [userId]);
  return q.rows?.[0] || null;
}

function canEditWiki(actor) {
  return Boolean(actor) && (actor.role === "admin" || actor.can_edit_wiki);
}

function canDeleteWiki(actor) {
  return Boolean(actor) && (actor.role === "admin" || actor.can_delete_wiki);
}

function baseArticleQuery() {
  return `
    SELECT
      w.id, w.title, w.category, w.body, w.images, w.created_by_user_id, w.created_at, w.updated_at,
      u.id AS author_id, u.first_name, u.last_name, u.email, u.avatar_url, u.nickname_color,
      u.badge_icon, u.experience, u.role AS author_role
    FROM wiki_articles w
    LEFT JOIN users u ON u.id = w.created_by_user_id
  `;
}

function baseCommentQuery() {
  return `
    SELECT
      c.id, c.article_id, c.user_id, c.body, c.created_at, c.updated_at, c.deleted_at,
      u.id AS comment_author_id, u.first_name, u.last_name, u.email, u.avatar_url, u.nickname_color,
      u.badge_icon, u.experience, u.role AS comment_author_role
    FROM wiki_comments c
    LEFT JOIN users u ON u.id = c.user_id
  `;
}

router.get("/", async (req, res) => {
  const db = getDb();
  const { category, search } = req.query;
  try {
    let q = baseArticleQuery();
    const params = [];
    const conditions = [];

    if (category) {
      params.push(String(category));
      conditions.push(`LOWER(w.category) = LOWER($${params.length})`);
    }
    if (search) {
      params.push(`%${String(search).toLowerCase()}%`);
      conditions.push(
        `(LOWER(w.title) LIKE $${params.length} OR LOWER(w.body) LIKE $${params.length} OR LOWER(w.category) LIKE $${params.length})`
      );
    }
    if (conditions.length) q += ` WHERE ${conditions.join(" AND ")}`;
    q += ` ORDER BY w.updated_at DESC`;

    const result = await db.query(q, params);
    return res.json((result.rows || []).map(normalizeArticle));
  } catch (e) {
    console.error("WIKI GET ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

router.get("/categories", async (_req, res) => {
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

router.get("/:id", async (req, res) => {
  const db = getDb();
  try {
    const result = await db.query(`${baseArticleQuery()} WHERE w.id=$1`, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "not found" });
    return res.json(normalizeArticle(result.rows[0]));
  } catch (e) {
    console.error("WIKI GET BY ID ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

router.get("/:id/comments", async (req, res) => {
  const db = getDb();
  try {
    const result = await db.query(
      `${baseCommentQuery()} WHERE c.article_id=$1 ORDER BY c.created_at ASC`,
      [req.params.id]
    );
    return res.json((result.rows || []).map(normalizeComment));
  } catch (e) {
    console.error("WIKI COMMENTS GET ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

router.post("/:id/comments", async (req, res) => {
  const db = getDb();
  const body = String(req.body?.body || "").trim();
  if (!body) return res.status(400).json({ error: "Comment body is required" });

  try {
    const article = await db.query(`SELECT id FROM wiki_articles WHERE id=$1`, [req.params.id]);
    if (!article.rows?.[0]) return res.status(404).json({ error: "Article not found" });

    const now = new Date().toISOString();
    const id = uid("wc_");
    await db.query(
      `INSERT INTO wiki_comments (id, article_id, user_id, body, created_at, updated_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, req.params.id, req.user.id, body, now, null, null]
    );

    const created = await db.query(`${baseCommentQuery()} WHERE c.id=$1`, [id]);
    const articleOwnerQ = await db.query(`SELECT created_by_user_id, title FROM wiki_articles WHERE id=$1`, [req.params.id]);
    const articleOwnerId = articleOwnerQ.rows?.[0]?.created_by_user_id;
    if (articleOwnerId && articleOwnerId !== req.user.id) {
      await createNotification(db, {
        userId: articleOwnerId,
        type: "wiki_comment",
        title: "New article comment",
        body: `A new comment was added to "${articleOwnerQ.rows[0].title}".`,
        entityType: "wiki_article",
        entityId: req.params.id,
      });
    }
    await createAuditLog(db, {
      actorUserId: req.user.id,
      action: "wiki.comment.created",
      entityType: "wiki_comment",
      entityId: id,
      summary: `Added comment to article ${req.params.id}`,
      details: "",
    });
    return res.json(normalizeComment(created.rows?.[0]));
  } catch (e) {
    console.error("WIKI COMMENTS POST ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

router.put("/:articleId/comments/:commentId", async (req, res) => {
  const db = getDb();
  const body = String(req.body?.body || "").trim();
  if (!body) return res.status(400).json({ error: "Comment body is required" });

  try {
    const actor = await getActor(db, req.user?.id);
    const current = await db.query(`SELECT * FROM wiki_comments WHERE id=$1 AND article_id=$2`, [req.params.commentId, req.params.articleId]);
    const comment = current.rows?.[0];
    if (!comment) return res.status(404).json({ error: "Comment not found" });
    if (comment.user_id !== req.user.id && actor?.role !== "admin") {
      return res.status(403).json({ error: "Cannot edit this comment" });
    }

    await db.query(`UPDATE wiki_comments SET body=$1, updated_at=$2 WHERE id=$3`, [
      body,
      new Date().toISOString(),
      req.params.commentId,
    ]);
    const updated = await db.query(`${baseCommentQuery()} WHERE c.id=$1`, [req.params.commentId]);
    await createAuditLog(db, {
      actorUserId: req.user.id,
      action: "wiki.comment.updated",
      entityType: "wiki_comment",
      entityId: req.params.commentId,
      summary: `Updated comment ${req.params.commentId}`,
      details: "",
    });
    return res.json(normalizeComment(updated.rows?.[0]));
  } catch (e) {
    console.error("WIKI COMMENTS PUT ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

router.delete("/:articleId/comments/:commentId", async (req, res) => {
  const db = getDb();
  try {
    const actor = await getActor(db, req.user?.id);
    const current = await db.query(`SELECT * FROM wiki_comments WHERE id=$1 AND article_id=$2`, [req.params.commentId, req.params.articleId]);
    const comment = current.rows?.[0];
    if (!comment) return res.status(404).json({ error: "Comment not found" });
    if (comment.user_id !== req.user.id && actor?.role !== "admin") {
      return res.status(403).json({ error: "Cannot delete this comment" });
    }

    await db.query(`DELETE FROM wiki_comments WHERE id=$1`, [req.params.commentId]);
    await createAuditLog(db, {
      actorUserId: req.user.id,
      action: "wiki.comment.deleted",
      entityType: "wiki_comment",
      entityId: req.params.commentId,
      summary: `Deleted comment ${req.params.commentId}`,
      details: "",
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error("WIKI COMMENTS DELETE ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

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

    if (req.user?.id) {
      await db.query(`UPDATE users SET experience = experience + $1 WHERE id=$2`, [
        XP_PER_ARTICLE,
        req.user.id,
      ]);
    }

    const created = await db.query(`${baseArticleQuery()} WHERE w.id=$1`, [id]);
    await createAuditLog(db, {
      actorUserId: req.user?.id ?? null,
      action: "wiki.article.created",
      entityType: "wiki_article",
      entityId: id,
      summary: `Created article ${t}`,
      details: JSON.stringify({ category: cat }),
    });
    return res.json(normalizeArticle(created.rows?.[0]));
  } catch (e) {
    console.error("WIKI POST ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

router.put("/:id", async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { title, category, body, images } = req.body ?? {};

  try {
    const actor = await getActor(db, req.user?.id);
    if (!canEditWiki(actor)) {
      return res.status(403).json({ error: "You do not have edit permission" });
    }

    const cur = await db.query(`SELECT * FROM wiki_articles WHERE id=$1`, [id]);
    const current = cur.rows?.[0];
    if (!current) return res.status(404).json({ error: "not found" });

    const next = {
      title: title != null ? String(title).trim() : current.title,
      category: category != null ? String(category).trim() : current.category,
      body: body != null ? String(body) : current.body,
      images:
        images != null
          ? (Array.isArray(images) ? images : [])
          : parseMedia(current.images),
    };

    if (!next.title) return res.status(400).json({ error: "title is required" });
    if (!next.category) return res.status(400).json({ error: "category is required" });

    const now = new Date().toISOString();
    await db.query(
      `UPDATE wiki_articles SET title=$1, category=$2, body=$3, images=$4, updated_at=$5 WHERE id=$6`,
      [next.title, next.category, next.body, JSON.stringify(next.images), now, id]
    );

    const updated = await db.query(`${baseArticleQuery()} WHERE w.id=$1`, [id]);
    await createAuditLog(db, {
      actorUserId: req.user?.id ?? null,
      action: "wiki.article.updated",
      entityType: "wiki_article",
      entityId: id,
      summary: `Updated article ${next.title}`,
      details: "",
    });
    return res.json(normalizeArticle(updated.rows?.[0]));
  } catch (e) {
    console.error("WIKI PUT ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

router.delete("/:id", async (req, res) => {
  const db = getDb();
  try {
    const actor = await getActor(db, req.user?.id);
    if (!canDeleteWiki(actor)) {
      return res.status(403).json({ error: "You do not have delete permission" });
    }

    await db.query(`DELETE FROM wiki_comments WHERE article_id=$1`, [req.params.id]);
    const d = await db.query(`DELETE FROM wiki_articles WHERE id=$1`, [req.params.id]);
    if (!d.rowCount) return res.status(404).json({ error: "not found" });
    await createAuditLog(db, {
      actorUserId: req.user?.id ?? null,
      action: "wiki.article.deleted",
      entityType: "wiki_article",
      entityId: req.params.id,
      summary: `Deleted article ${req.params.id}`,
      details: "",
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error("WIKI DELETE ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
