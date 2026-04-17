import { Router } from "express";
import { getDb } from "../db.js";
import { authRequired } from "../middleware/auth.js";
import {
  buildZohoAuthUrl,
  buildZohoAuthUrlForBot,
  clearZohoConnection,
  decodeZohoState,
  exchangeZohoCode,
  fetchZohoCurrentUser,
  fetchZohoProjectUsers,
  fetchZohoProjects,
  fetchZohoTasks,
  getZohoFrontendRedirect,
  storeZohoConnection,
  storeZohoConnectionForBot,
} from "../utils/zoho.js";
import { serializeUser } from "../utils/users.js";

const r = Router();

async function getCurrentUser(db, userId) {
  const q = await db.query(`SELECT * FROM users WHERE id=$1`, [userId]);
  return q.rows?.[0] || null;
}

r.get("/connect", authRequired, async (req, res) => {
  try {
    return res.json({ url: buildZohoAuthUrl(req.user.id) });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Failed to prepare Zoho connection" });
  }
});

r.get("/status", authRequired, async (req, res) => {
  const db = getDb();
  try {
    const user = await getCurrentUser(db, req.user.id);
    return res.json({
      connected: Boolean(user?.zoho_refresh_token),
      portal_name: user?.zoho_portal_name || process.env.ZOHO_PORTAL_NAME || "",
      account_email: user?.zoho_account_email || "",
      connected_at: user?.zoho_connected_at || "",
      user: serializeUser(user),
    });
  } catch (e) {
    console.error("ZOHO STATUS ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

r.get("/callback", async (req, res) => {
  const db = getDb();
  const { code, state, error } = req.query ?? {};

  if (error) {
    return res.redirect(getZohoFrontendRedirect(false, String(error)));
  }

  const parsedState = decodeZohoState(state);
  if (!code) {
    return res.redirect(getZohoFrontendRedirect(false, "Invalid Zoho callback state"));
  }

  // ── Bot user OAuth callback ──
  if (parsedState?.type === "bot" && parsedState?.chatId) {
    try {
      const tokenData = await exchangeZohoCode(String(code));
      await storeZohoConnectionForBot(db, parsedState.chatId, tokenData, {});
      return res.send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:40px">
          <h2>✅ Zoho подключён!</h2>
          <p>Можешь закрыть эту страницу и вернуться в Telegram.</p>
        </body></html>
      `);
    } catch (e) {
      console.error("ZOHO BOT CALLBACK ERROR:", e);
      return res.send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:40px">
          <h2>❌ Ошибка подключения</h2>
          <p>${e?.message || "Zoho connection failed"}</p>
        </body></html>
      `);
    }
  }

  // ── Web app user OAuth callback ──
  if (!parsedState?.userId) {
    return res.redirect(getZohoFrontendRedirect(false, "Invalid Zoho callback state"));
  }

  try {
    const user = await getCurrentUser(db, parsedState.userId);
    if (!user) {
      return res.redirect(getZohoFrontendRedirect(false, "User not found"));
    }

    const tokenData = await exchangeZohoCode(String(code));
    await storeZohoConnection(db, user.id, tokenData, {});
    const connectedUser = await getCurrentUser(db, user.id);
    const accountData = await fetchZohoCurrentUser(db, connectedUser);
    await storeZohoConnection(db, user.id, tokenData, accountData);
    return res.redirect(getZohoFrontendRedirect(true));
  } catch (e) {
    console.error("ZOHO CALLBACK ERROR:", e);
    return res.redirect(getZohoFrontendRedirect(false, e?.message || "Zoho connection failed"));
  }
});

r.post("/disconnect", authRequired, async (req, res) => {
  const db = getDb();
  try {
    await clearZohoConnection(db, req.user.id);
    const user = await getCurrentUser(db, req.user.id);
    return res.json({ ok: true, user: serializeUser(user) });
  } catch (e) {
    console.error("ZOHO DISCONNECT ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

r.get("/projects", authRequired, async (req, res) => {
  const db = getDb();
  try {
    const user = await getCurrentUser(db, req.user.id);
    if (!user?.zoho_refresh_token) {
      return res.status(400).json({ error: "Connect your Zoho account first" });
    }
    return res.json({ projects: await fetchZohoProjects(db, user) });
  } catch (e) {
    console.error("ZOHO PROJECTS ERROR:", e);
    return res.status(500).json({ error: e?.message || "Failed to load Zoho projects" });
  }
});

r.get("/projects/:projectId/tasks", authRequired, async (req, res) => {
  const db = getDb();
  try {
    const user = await getCurrentUser(db, req.user.id);
    if (!user?.zoho_refresh_token) {
      return res.status(400).json({ error: "Connect your Zoho account first" });
    }
    return res.json({ tasks: await fetchZohoTasks(db, user, req.params.projectId) });
  } catch (e) {
    console.error("ZOHO TASKS ERROR:", e);
    return res.status(500).json({ error: e?.message || "Failed to load Zoho tasks" });
  }
});

r.get("/projects/:projectId/users", authRequired, async (req, res) => {
  const db = getDb();
  try {
    const user = await getCurrentUser(db, req.user.id);
    if (!user?.zoho_refresh_token) {
      return res.status(400).json({ error: "Connect your Zoho account first" });
    }
    return res.json({ users: await fetchZohoProjectUsers(db, user, req.params.projectId) });
  } catch (e) {
    console.error("ZOHO PROJECT USERS ERROR:", e);
    return res.status(500).json({ error: e?.message || "Failed to load Zoho project users" });
  }
});

export default r;
