import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db.js";
import { requireAdmin } from "../middleware/auth.js";
import {
  ALLOWED_BADGE_ICONS,
  ALLOWED_NICKNAME_COLORS,
  BADGE_CHANGE_COST,
  COLOR_CHANGE_COST,
  getAvailableExperience,
  serializeUser,
} from "../utils/users.js";

const r = Router();

const avatarSchema = z.object({
  avatar_url: z.string().max(1024 * 1024).optional().default(""),
});

const customizeSchema = z.object({
  nickname_color: z.string().optional().default(""),
  badge_icon: z.string().optional().default(""),
});

const permissionSchema = z.object({
  can_edit_wiki: z.boolean(),
  can_delete_wiki: z.boolean(),
});

const adminProfileSchema = z.object({
  first_name: z.string().trim().min(1),
  last_name: z.string().trim().min(1),
  role_label: z.string().trim().min(1).max(60),
});

async function getCurrentUser(db, userId) {
  const q = await db.query(`SELECT * FROM users WHERE id=$1`, [userId]);
  return q.rows?.[0] || null;
}

r.get("/me", async (req, res) => {
  const db = getDb();
  try {
    const user = await getCurrentUser(db, req.user.id);
    return res.json({ user: serializeUser(user) });
  } catch (e) {
    console.error("USERS /me ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

r.put("/me/avatar", async (req, res) => {
  const parsed = avatarSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid avatar payload" });
  }

  const db = getDb();
  const avatarUrl = String(parsed.data.avatar_url || "");

  if (avatarUrl && !avatarUrl.startsWith("data:image/")) {
    return res.status(400).json({ error: "Avatar must be an image" });
  }

  try {
    await db.query(`UPDATE users SET avatar_url=$1 WHERE id=$2`, [
      avatarUrl,
      req.user.id,
    ]);
    const user = await getCurrentUser(db, req.user.id);
    return res.json({ user: serializeUser(user) });
  } catch (e) {
    console.error("USERS /me/avatar ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

r.post("/me/customize", async (req, res) => {
  const parsed = customizeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid customization payload" });
  }

  const db = getDb();
  try {
    const user = await getCurrentUser(db, req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const nicknameColor = String(parsed.data.nickname_color || "");
    const badgeIcon = String(parsed.data.badge_icon || "");

    if (!ALLOWED_NICKNAME_COLORS.includes(nicknameColor)) {
      return res.status(400).json({ error: "Unsupported nickname color" });
    }
    if (!ALLOWED_BADGE_ICONS.includes(badgeIcon)) {
      return res.status(400).json({ error: "Unsupported badge icon" });
    }

    let extraCost = 0;
    if (user.role !== "admin") {
      if (nicknameColor !== (user.nickname_color || "")) extraCost += COLOR_CHANGE_COST;
      if (badgeIcon !== (user.badge_icon || "")) extraCost += BADGE_CHANGE_COST;

      if (extraCost > getAvailableExperience(user)) {
        return res.status(400).json({ error: "Not enough experience" });
      }
    }

    await db.query(
      `UPDATE users
       SET nickname_color=$1, badge_icon=$2, spent_experience=spent_experience + $3
       WHERE id=$4`,
      [nicknameColor, badgeIcon, user.role === "admin" ? 0 : extraCost, req.user.id]
    );

    const nextUser = await getCurrentUser(db, req.user.id);
    return res.json({
      user: serializeUser(nextUser),
      spent_now: user.role === "admin" ? 0 : extraCost,
    });
  } catch (e) {
    console.error("USERS /me/customize ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

r.get("/leaderboard", async (_req, res) => {
  const db = getDb();
  try {
    const q = await db.query(
      `SELECT id,email,first_name,last_name,role,role_label,avatar_url,can_edit_wiki,can_delete_wiki,
              experience,spent_experience,nickname_color,badge_icon,created_at
       FROM users
       ORDER BY experience DESC, created_at ASC`
    );
    return res.json({ users: (q.rows || []).map(serializeUser) });
  } catch (e) {
    console.error("USERS /leaderboard ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

r.get("/", async (_req, res) => {
  const db = getDb();
  try {
    const q = await db.query(
      `SELECT id,email,first_name,last_name,role,role_label,avatar_url,can_edit_wiki,can_delete_wiki,
              experience,spent_experience,nickname_color,badge_icon,created_at
       FROM users
       ORDER BY created_at DESC`
    );
    return res.json({ users: (q.rows || []).map(serializeUser) });
  } catch (e) {
    console.error("USERS / ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

r.get("/admin/list", requireAdmin, async (_req, res) => {
  const db = getDb();
  try {
    const q = await db.query(
      `SELECT id,email,first_name,last_name,role,role_label,avatar_url,can_edit_wiki,can_delete_wiki,
              experience,spent_experience,nickname_color,badge_icon,created_at
       FROM users
       ORDER BY created_at DESC`
    );
    return res.json({ users: (q.rows || []).map(serializeUser) });
  } catch (e) {
    console.error("USERS /admin/list ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

r.put("/:id/permissions", requireAdmin, async (req, res) => {
  const parsed = permissionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid permissions payload" });
  }

  const { id } = req.params;
  const db = getDb();

  try {
    const existing = await getCurrentUser(db, id);
    if (!existing) return res.status(404).json({ error: "User not found" });

    if (existing.role === "admin") {
      return res.status(400).json({ error: "Admin permissions are fixed" });
    }

    await db.query(
      `UPDATE users SET can_edit_wiki=$1, can_delete_wiki=$2 WHERE id=$3`,
      [parsed.data.can_edit_wiki, parsed.data.can_delete_wiki, id]
    );

    const updated = await getCurrentUser(db, id);
    return res.json({ user: serializeUser(updated) });
  } catch (e) {
    console.error("USERS /:id/permissions ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

r.put("/:id/admin-profile", requireAdmin, async (req, res) => {
  const parsed = adminProfileSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid admin profile payload" });
  }

  const { id } = req.params;
  const db = getDb();

  try {
    const existing = await getCurrentUser(db, id);
    if (!existing) return res.status(404).json({ error: "User not found" });

    await db.query(
      `UPDATE users SET first_name=$1, last_name=$2, role_label=$3 WHERE id=$4`,
      [parsed.data.first_name, parsed.data.last_name, parsed.data.role_label, id]
    );

    const updated = await getCurrentUser(db, id);
    return res.json({ user: serializeUser(updated) });
  } catch (e) {
    console.error("USERS /:id/admin-profile ERROR:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

export default r;
