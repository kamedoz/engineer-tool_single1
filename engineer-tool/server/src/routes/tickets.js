// server/src/routes/tickets.js
import express from "express";
import { getDb } from "../db.js";
import { uid } from "../utils/uid.js";
import { createAuditLog, createNotification } from "../utils/activity.js";
import { completeZohoTask, createZohoTask, createZohoTimeLog } from "../utils/zoho.js";
import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

function nowIso() {
  return new Date().toISOString();
}

async function getCurrentUser(db, userId) {
  const q = await db.query(`SELECT * FROM users WHERE id=$1`, [userId]);
  return q.rows?.[0] || null;
}

function computeElapsedSeconds(ticket) {
  const base = Math.max(0, Number(ticket?.timer_elapsed_seconds) || 0);
  if (!ticket?.timer_started_at) return base;
  const started = Date.parse(ticket.timer_started_at);
  if (!started) return base;
  return base + Math.max(0, Math.floor((Date.now() - started) / 1000));
}

async function getTicketById(db, id) {
  const q = await db.query(`SELECT * FROM tickets WHERE id=$1`, [id]);
  return q.rows?.[0] || null;
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
        t.created_at, t.completed_at,
        t.zoho_project_id, t.zoho_project_name, t.zoho_task_id, t.zoho_task_key, t.zoho_task_name,
        t.zoho_sync_status, t.zoho_last_sync_at, t.zoho_last_sync_error,
        t.timer_started_at, t.timer_elapsed_seconds
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
  const { site, visit_date, engineer_user_id, category_id, issue_id, issue_text, description, zoho_project_id, zoho_project_name, zoho_task_id, zoho_task_key, zoho_task_name } =
    req.body ?? {};

  // Client sends `description`, older API uses `issue_text`.
  const text = (issue_text ?? description) ?? null;

  const id = uid("t_");
  const createdAt = nowIso();

  try {
    let zohoTaskId = zoho_task_id ?? null;
    let zohoTaskKey = zoho_task_key ?? null;
    let zohoTaskName = zoho_task_name ?? null;
    let zohoSyncStatus = null;

    if (zoho_project_id && !zohoTaskId) {
      const actor = await getCurrentUser(db, req.user.id);
      if (!actor?.zoho_refresh_token) {
        return res.status(400).json({ error: "Connect your Zoho account first" });
      }
      const createdTask = await createZohoTask(db, actor, zoho_project_id, {
        name: zoho_task_name || site || "New Zoho task",
        description: text || "",
      });
      zohoTaskId = createdTask.id;
      zohoTaskKey = createdTask.key;
      zohoTaskName = createdTask.name;
      zohoSyncStatus = "task_created";
    } else if (zoho_project_id && zohoTaskId) {
      zohoSyncStatus = "linked_existing_task";
    }

    await db.query(
      `
      INSERT INTO tickets (
        id, status, site, visit_date,
        category_id, issue_id, issue_text,
        engineer_user_id, created_by_user_id,
        created_at, completed_at,
        zoho_project_id, zoho_project_name, zoho_task_id, zoho_task_key, zoho_task_name, zoho_sync_status,
        timer_started_at, timer_elapsed_seconds
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
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
        zoho_project_id ?? null,
        zoho_project_name ?? null,
        zohoTaskId,
        zohoTaskKey,
        zohoTaskName,
        zohoSyncStatus,
        null,
        0,
      ]
    );

    const q = await db.query(`SELECT * FROM tickets WHERE id=$1`, [id]);
    await createAuditLog(db, {
      actorUserId: req.user?.id ?? null,
      action: "ticket.created",
      entityType: "ticket",
      entityId: id,
      summary: `Created ticket ${id}`,
      details: JSON.stringify({ site: site ?? null, engineer_user_id: engineer_user_id ?? null }),
    });
    if (engineer_user_id) {
      await createNotification(db, {
        userId: engineer_user_id,
        type: "ticket_assigned",
        title: "New ticket assigned",
        body: site ? `You were assigned to ${site}.` : "A new ticket was assigned to you.",
        entityType: "ticket",
        entityId: id,
      });
    }
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
    await createAuditLog(db, {
      actorUserId: req.user?.id ?? null,
      action: "ticket.status.updated",
      entityType: "ticket",
      entityId: id,
      summary: `Changed ticket ${id} status to ${s}`,
      details: "",
    });
    return res.json(q.rows?.[0] || null);
  } catch (e) {
    console.error("TICKETS STATUS ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

router.post("/:id/timer/start", async (req, res) => {
  const db = getDb();
  const { id } = req.params;

  try {
    const ticket = await getTicketById(db, id);
    if (!ticket) return res.status(404).json({ error: "not found" });
    if (ticket.timer_started_at) return res.json({ ticket: { ...ticket, timer_elapsed_seconds: computeElapsedSeconds(ticket) } });

    const startedAt = nowIso();
    await db.query(`UPDATE tickets SET timer_started_at=$1 WHERE id=$2`, [startedAt, id]);
    const updated = await getTicketById(db, id);
    return res.json({ ticket: { ...updated, timer_elapsed_seconds: computeElapsedSeconds(updated) } });
  } catch (e) {
    console.error("TICKET TIMER START ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

router.post("/:id/timer/stop", async (req, res) => {
  const db = getDb();
  const { id } = req.params;

  try {
    const ticket = await getTicketById(db, id);
    if (!ticket) return res.status(404).json({ error: "not found" });

    const nextElapsed = computeElapsedSeconds(ticket);
    await db.query(`UPDATE tickets SET timer_started_at=NULL, timer_elapsed_seconds=$1 WHERE id=$2`, [nextElapsed, id]);
    const updated = await getTicketById(db, id);
    return res.json({ ticket: { ...updated, timer_elapsed_seconds: computeElapsedSeconds(updated) } });
  } catch (e) {
    console.error("TICKET TIMER STOP ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

router.post("/:id/zoho-close", async (req, res) => {
  const db = getDb();
  const { id } = req.params;

  try {
    const ticket = await getTicketById(db, id);
    if (!ticket) return res.status(404).json({ error: "not found" });
    if (!ticket.zoho_project_id) return res.status(400).json({ error: "Ticket is not linked to a Zoho project" });

    const actor = await getCurrentUser(db, req.user.id);
    if (!actor?.zoho_refresh_token) {
      return res.status(400).json({ error: "Connect your Zoho account first" });
    }

    let zohoTaskId = ticket.zoho_task_id;
    let zohoTaskKey = ticket.zoho_task_key;
    let zohoTaskName = ticket.zoho_task_name;

    if (!zohoTaskId) {
      const createdTask = await createZohoTask(db, actor, ticket.zoho_project_id, {
        name: ticket.zoho_task_name || ticket.site || "New Zoho task",
        description: ticket.issue_text || "",
      });
      zohoTaskId = createdTask.id;
      zohoTaskKey = createdTask.key;
      zohoTaskName = createdTask.name;
    }

    const elapsedSeconds = computeElapsedSeconds(ticket);
    if (elapsedSeconds > 0) {
      await createZohoTimeLog(
        db,
        actor,
        ticket.zoho_project_id,
        zohoTaskId,
        elapsedSeconds,
        ticket.site ? `Engineer Tool: ${ticket.site}` : "Engineer Tool time log"
      );
    }
    await completeZohoTask(db, actor, ticket.zoho_project_id, zohoTaskId);

    const completedAt = nowIso();
    await db.query(
      `UPDATE tickets
       SET status='closed',
           completed_at=$1,
           timer_started_at=NULL,
           timer_elapsed_seconds=$2,
           zoho_task_id=$3,
           zoho_task_key=$4,
           zoho_task_name=$5,
           zoho_sync_status='closed_synced',
           zoho_last_sync_at=$6,
           zoho_last_sync_error=NULL,
           synced_by_user_id=$7
       WHERE id=$8`,
      [completedAt, elapsedSeconds, zohoTaskId, zohoTaskKey, zohoTaskName, completedAt, req.user.id, id]
    );

    await createAuditLog(db, {
      actorUserId: req.user?.id ?? null,
      action: "ticket.zoho.closed",
      entityType: "ticket",
      entityId: id,
      summary: `Closed ticket ${id} and synced it to Zoho`,
      details: JSON.stringify({ zoho_project_id: ticket.zoho_project_id, zoho_task_id: zohoTaskId, elapsedSeconds }),
    });

    const updated = await getTicketById(db, id);
    return res.json({ ticket: { ...updated, timer_elapsed_seconds: computeElapsedSeconds(updated) } });
  } catch (e) {
    console.error("TICKET ZOHO CLOSE ERROR:", e);
    await db.query(
      `UPDATE tickets SET zoho_sync_status='sync_failed', zoho_last_sync_error=$1 WHERE id=$2`,
      [e?.message || "Zoho sync failed", id]
    );
    return res.status(500).json({ error: e?.message || "Failed to sync with Zoho" });
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
