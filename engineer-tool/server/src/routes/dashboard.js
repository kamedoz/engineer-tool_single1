import { Router } from "express";
import { getDb } from "../db.js";

const r = Router();

r.get("/", async (req, res) => {
  const db = getDb();
  const me = req.user?.id;
  const isAdmin = req.user?.role === "admin";

  try {
    const ticketsWhere = isAdmin ? "" : `WHERE engineer_user_id = $1 OR created_by_user_id = $1`;
    const ticketParams = isAdmin ? [] : [me];
    const openTicketsQ = await db.query(`SELECT COUNT(*)::int AS count FROM tickets ${ticketsWhere ? `${ticketsWhere} AND status='open'` : `WHERE status='open'`}`, ticketParams);
    const closedTodayQ = await db.query(
      `SELECT COUNT(*)::int AS count FROM tickets
       WHERE status='closed' AND completed_at >= $1`,
      [new Date(new Date().setHours(0, 0, 0, 0)).toISOString()]
    );
    const wikiQ = await db.query(`SELECT COUNT(*)::int AS count FROM wiki_articles`);
    const topContributorsQ = await db.query(
      `SELECT id, first_name, last_name, email, experience, badge_icon, nickname_color
       FROM users ORDER BY experience DESC, created_at ASC LIMIT 5`
    );
    const unreadQ = await db.query(`SELECT COUNT(*)::int AS count FROM notifications WHERE user_id=$1 AND is_read=FALSE`, [me]);
    const commentsQ = await db.query(
      `SELECT COUNT(*)::int AS count FROM wiki_comments
       WHERE deleted_at IS NULL AND created_at >= $1`,
      [new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()]
    );

    return res.json({
      open_tickets: openTicketsQ.rows?.[0]?.count || 0,
      closed_today: closedTodayQ.rows?.[0]?.count || 0,
      knowledge_articles: wikiQ.rows?.[0]?.count || 0,
      unread_notifications: unreadQ.rows?.[0]?.count || 0,
      recent_comments: commentsQ.rows?.[0]?.count || 0,
      top_contributors: topContributorsQ.rows || [],
    });
  } catch (e) {
    console.error("DASHBOARD ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

export default r;
