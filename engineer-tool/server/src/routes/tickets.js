// server/src/routes/tickets.js
import express from "express";
import { getDb } from "../db.js";
import { uid } from "../utils/uid.js";
import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";

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
        i.steps AS issue_steps, i.solution AS issue_solution,
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
 * POST /api/tickets/:id/bootstrap-steps
 * body: { steps: string[] }
 * If ticket_steps is empty, create rows with step_index.
 */
router.post("/:id/bootstrap-steps", async (req, res) => {
  const db = getDb();
  const { id: ticketId } = req.params;
  const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];

  try {
    const existing = await db.query(
      `SELECT id, ticket_id, step_index, step_text, result, checked_at, created_at
       FROM ticket_steps WHERE ticket_id=$1 ORDER BY step_index ASC NULLS LAST, created_at ASC`,
      [ticketId]
    );
    if ((existing.rows || []).length > 0) return res.json(existing.rows);

    const cleaned = steps
      .map((x) => String(x || "").trim())
      .filter(Boolean);

    const createdAt = nowIso();
    for (let i = 0; i < cleaned.length; i++) {
      await db.query(
        `INSERT INTO ticket_steps (id, ticket_id, step_index, step_text, result, checked_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [uid("ts_"), ticketId, i, cleaned[i], null, null, createdAt]
      );
    }

    const q = await db.query(
      `SELECT id, ticket_id, step_index, step_text, result, checked_at, created_at
       FROM ticket_steps WHERE ticket_id=$1 ORDER BY step_index ASC NULLS LAST, created_at ASC`,
      [ticketId]
    );
    return res.json(q.rows || []);
  } catch (e) {
    console.error("TICKET BOOTSTRAP STEPS ERROR:", e);
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
      `SELECT id, ticket_id, step_index, step_text, result, checked_at, created_at
       FROM ticket_steps WHERE ticket_id=$1
       ORDER BY step_index ASC NULLS LAST, created_at ASC`,
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
  const { step_text, step_index } = req.body ?? {};
  const txt = String(step_text || "").trim();
  if (!txt) return res.status(400).json({ error: "step_text is required" });

  const id = uid("ts_");
  const createdAt = nowIso();

  try {
    await db.query(
      `INSERT INTO ticket_steps (id, ticket_id, step_index, step_text, result, checked_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, ticketId, Number.isFinite(step_index) ? step_index : null, txt, null, null, createdAt]
    );
    return res.json({ id, ticket_id: ticketId, step_index: Number.isFinite(step_index) ? step_index : null, step_text: txt, result: null, checked_at: null, created_at: createdAt });
  } catch (e) {
    console.error("TICKET STEPS POST ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

/**
 * PUT /api/tickets/:ticketId/steps/:stepId
 * body: { result: true|false|null }
 */
router.put("/:ticketId/steps/:stepId", async (req, res) => {
  const db = getDb();
  const { ticketId, stepId } = req.params;
  const r = req.body?.result;
  const result = r === true ? "pass" : r === false ? "fail" : null;
  const checkedAt = result ? nowIso() : null;

  try {
    const u = await db.query(
      `UPDATE ticket_steps SET result=$1, checked_at=$2 WHERE id=$3 AND ticket_id=$4`,
      [result, checkedAt, stepId, ticketId]
    );
    if (!u.rowCount) return res.status(404).json({ error: "not found" });
    const q = await db.query(
      `SELECT id, ticket_id, step_index, step_text, result, checked_at, created_at
       FROM ticket_steps WHERE id=$1`,
      [stepId]
    );
    return res.json(q.rows?.[0] || null);
  } catch (e) {
    console.error("TICKET STEP UPDATE ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

/**
 * GET /api/tickets/:id/report.pdf
 * Generates a readable PDF report (with Cyrillic-safe font).
 */
router.get("/:id/report.pdf", async (req, res) => {
  const db = getDb();
  const { id } = req.params;

  try {
    const t = await db.query(
      `SELECT
        t.id, t.status, t.site, t.visit_date, t.created_at, t.completed_at,
        t.issue_text AS description,
        c.name AS category_name,
        i.title AS issue_title, i.description AS issue_description, i.solution AS issue_solution,
        u.first_name AS engineer_first_name, u.last_name AS engineer_last_name, u.email AS engineer_email,
        cu.first_name AS creator_first_name, cu.last_name AS creator_last_name, cu.email AS creator_email
      FROM tickets t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN issues i ON i.id = t.issue_id
      LEFT JOIN users u ON u.id = t.engineer_user_id
      LEFT JOIN users cu ON cu.id = t.created_by_user_id
      WHERE t.id=$1`,
      [id]
    );
    if (!t.rows?.[0]) return res.status(404).send("Not found");
    const ticket = t.rows[0];

    const stepsQ = await db.query(
      `SELECT step_index, step_text, result, checked_at
       FROM ticket_steps WHERE ticket_id=$1
       ORDER BY step_index ASC NULLS LAST, created_at ASC`,
      [id]
    );
    const notesQ = await db.query(
      `SELECT note_text, created_at FROM ticket_notes WHERE ticket_id=$1 ORDER BY created_at ASC`,
      [id]
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="ticket_${id}.pdf"`
    );

    const doc = new PDFDocument({ size: "A4", margin: 48 });
    doc.pipe(res);

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const fontPath = path.join(__dirname, "..", "DejaVuSans.ttf");
    doc.registerFont("DejaVu", fontPath);
    doc.font("DejaVu");

    const H1 = 18;
    const H2 = 12;
    const BODY = 11;

    doc.fontSize(H1).text("Engineer Tool — Ticket Report", { align: "left" });
    doc.moveDown(0.6);

    doc.fontSize(H2).text(`Ticket ID: ${ticket.id}`);
    doc.fontSize(BODY).text(`Status: ${ticket.status || "open"}`);
    if (ticket.site) doc.text(`Site: ${ticket.site}`);
    if (ticket.visit_date) doc.text(`Visit date: ${ticket.visit_date}`);
    if (ticket.category_name) doc.text(`Category: ${ticket.category_name}`);
    if (ticket.issue_title) doc.text(`Issue template: ${ticket.issue_title}`);

    const engName = `${ticket.engineer_first_name || ""} ${ticket.engineer_last_name || ""}`.trim();
    if (ticket.engineer_email) doc.text(`Assigned engineer: ${engName || ""} (${ticket.engineer_email})`);

    const crName = `${ticket.creator_first_name || ""} ${ticket.creator_last_name || ""}`.trim();
    if (ticket.creator_email) doc.text(`Created by: ${crName || ""} (${ticket.creator_email})`);

    doc.text(`Created at: ${ticket.created_at}`);
    if (ticket.completed_at) doc.text(`Completed at: ${ticket.completed_at}`);

    doc.moveDown(0.8);
    doc.fontSize(H2).text("Description", { underline: true });
    doc.fontSize(BODY).text(ticket.description || "", { width: 500 });

    if (ticket.issue_description) {
      doc.moveDown(0.6);
      doc.fontSize(H2).text("Template description / symptoms", { underline: true });
      doc.fontSize(BODY).text(ticket.issue_description, { width: 500 });
    }

    doc.moveDown(0.8);
    doc.fontSize(H2).text("Checklist", { underline: true });
    const steps = stepsQ.rows || [];
    if (steps.length === 0) {
      doc.fontSize(BODY).text("No steps.");
    } else {
      steps.forEach((s, idx) => {
        const n = Number.isFinite(s.step_index) ? s.step_index + 1 : idx + 1;
        const r = s.result === "pass" ? "✅" : s.result === "fail" ? "❌" : "—";
        doc.fontSize(BODY).text(`${n}. [${r}] ${s.step_text}`);
      });
    }

    const notes = notesQ.rows || [];
    doc.moveDown(0.8);
    doc.fontSize(H2).text("Notes", { underline: true });
    if (notes.length === 0) {
      doc.fontSize(BODY).text("No notes.");
    } else {
      notes.forEach((n) => {
        doc.fontSize(BODY).text(`• ${n.note_text}`);
      });
    }

    if (ticket.issue_solution) {
      doc.moveDown(0.8);
      doc.fontSize(H2).text("Solution", { underline: true });
      doc.fontSize(BODY).text(ticket.issue_solution, { width: 500 });
    }

    doc.moveDown(1.2);
    doc.fontSize(9).text("Generated by Engineer Tool", { align: "right", opacity: 0.8 });

    doc.end();
  } catch (e) {
    console.error("TICKET REPORT PDF ERROR:", e);
    return res.status(500).send("Internal error");
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
