// server/src/routes/tickets.js
import express from "express";
import { getDb } from "../db.js";
import { uid } from "../utils/uid.js";

const router = express.Router();

function nowIso() {
  return new Date().toISOString();
}

/**
 * GET /api/tickets
 */
router.get("/", async (req, res) => {
  const db = getDb();
  const isAdmin = req.user?.role === "admin";

  try {
    const params = [];
    const where = isAdmin
      ? ""
      : "WHERE (t.engineer_user_id = $1 OR t.created_by_user_id = $1)";
    if (!isAdmin) params.push(req.user?.id);

    const q = await db.query(
      `
      SELECT
        t.id, t.status, t.site, t.visit_date,
        t.category_id, c.name AS category_name,
        t.issue_id, i.title AS issue_title, i.description AS issue_description,
        t.issue_text AS description,
        t.engineer_user_id,
        u.first_name AS engineer_first_name, u.last_name AS engineer_last_name, u.email AS engineer_email,
        t.created_by_user_id,
        cu.first_name AS creator_first_name, cu.last_name AS creator_last_name, cu.email AS creator_email,
        t.created_at, t.completed_at
      FROM tickets t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN issues i ON i.id = t.issue_id
      LEFT JOIN users u ON u.id = t.engineer_user_id
      LEFT JOIN users cu ON cu.id = t.created_by_user_id
      ${where}
      ORDER BY t.created_at DESC
      `,
      params
    );

    return res.json(q.rows || []);
  } catch (e) {
    console.error("TICKETS GET ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

/**
 * POST /api/tickets
 * body: { site, visit_date, engineer_user_id?, category_id?, issue_id?, issue_text? }
 */
router.post("/", async (req, res) => {
  const db = getDb();
  const { site, visit_date, engineer_user_id, category_id, issue_id, issue_text, description } =
    req.body ?? {};

  // Client sends `description`, older API uses `issue_text`.
  const text = (issue_text ?? description) ?? null;

  const id = uid("t_");
  const createdAt = nowIso();

  try {
    await db.query(
      `
      INSERT INTO tickets (
        id, status, site, visit_date,
        category_id, issue_id, issue_text,
        engineer_user_id, created_by_user_id,
        created_at, completed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `,
      [
        id,
        "open",
        site ?? null,
        visit_date ?? null,
        category_id ?? null,
        issue_id ?? null,
        text,
        engineer_user_id ?? null,
        req.user?.id ?? null,
        createdAt,
        null,
      ]
    );

    const q = await db.query(`SELECT * FROM tickets WHERE id=$1`, [id]);
    return res.json(q.rows?.[0] || null);
  } catch (e) {
    console.error("TICKETS POST ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

/**
 * PUT /api/tickets/:id/status
 * body: { status: 'open'|'closed' }
 */
router.put("/:id/status", async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { status } = req.body ?? {};
  const s = String(status || "").trim();

  if (!["open", "closed"].includes(s)) {
    return res.status(400).json({ error: "status must be open|closed" });
  }

  const completedAt = s === "closed" ? nowIso() : null;

  try {
    const u = await db.query(
      `UPDATE tickets SET status=$1, completed_at=$2 WHERE id=$3`,
      [s, completedAt, id]
    );
    if (!u.rowCount) return res.status(404).json({ error: "not found" });

    const q = await db.query(`SELECT * FROM tickets WHERE id=$1`, [id]);
    return res.json(q.rows?.[0] || null);
  } catch (e) {
    console.error("TICKETS STATUS ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

/**
 * GET /api/tickets/:id/steps
 */
router.get("/:id/steps", async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  try {
    const q = await db.query(
      `SELECT id, ticket_id, step_text, created_at FROM ticket_steps WHERE ticket_id=$1 ORDER BY created_at ASC`,
      [id]
    );
    return res.json(q.rows || []);
  } catch (e) {
    console.error("TICKET STEPS GET ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

/**
 * POST /api/tickets/:id/steps
 * body: { step_text }
 */
router.post("/:id/steps", async (req, res) => {
  const db = getDb();
  const { id: ticketId } = req.params;
  const { step_text } = req.body ?? {};
  const txt = String(step_text || "").trim();
  if (!txt) return res.status(400).json({ error: "step_text is required" });

  const id = uid("ts_");
  const createdAt = nowIso();

  try {
    await db.query(
      `INSERT INTO ticket_steps (id, ticket_id, step_text, created_at) VALUES ($1,$2,$3,$4)`,
      [id, ticketId, txt, createdAt]
    );
    return res.json({ id, ticket_id: ticketId, step_text: txt, created_at: createdAt });
  } catch (e) {
    console.error("TICKET STEPS POST ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

/**
 * GET /api/tickets/:id/notes
 */
router.get("/:id/notes", async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  try {
    const q = await db.query(
      `SELECT id, ticket_id, note_text, created_at FROM ticket_notes WHERE ticket_id=$1 ORDER BY created_at ASC`,
      [id]
    );
    return res.json(q.rows || []);
  } catch (e) {
    console.error("TICKET NOTES GET ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

/**
 * POST /api/tickets/:id/notes
 * body: { note_text }
 */
router.post("/:id/notes", async (req, res) => {
  const db = getDb();
  const { id: ticketId } = req.params;
  const { note_text } = req.body ?? {};
  const txt = String(note_text || "").trim();
  if (!txt) return res.status(400).json({ error: "note_text is required" });

  const id = uid("tn_");
  const createdAt = nowIso();

  try {
    await db.query(
      `INSERT INTO ticket_notes (id, ticket_id, note_text, created_at) VALUES ($1,$2,$3,$4)`,
      [id, ticketId, txt, createdAt]
    );
    return res.json({ id, ticket_id: ticketId, note_text: txt, created_at: createdAt });
  } catch (e) {
    console.error("TICKET NOTES POST ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
