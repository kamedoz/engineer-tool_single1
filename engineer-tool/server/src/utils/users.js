export const XP_PER_ARTICLE = 5;
export const XP_PER_LEVEL = 20;
export const MAX_LEVEL = 100;
export const COLOR_CHANGE_COST = 20;
export const BADGE_CHANGE_COST = 100;

export const ALLOWED_NICKNAME_COLORS = [
  "",
  "#e5e7eb",
  "#60a5fa",
  "#34d399",
  "#f59e0b",
  "#f472b6",
  "#a78bfa",
  "#f87171",
  "#ef4444",
];

export const ALLOWED_BADGE_ICONS = [
  "",
  "★",
  "⚙",
  "🛠",
  "📘",
  "🚀",
];

export function getUserLevel(experience = 0) {
  const safeXp = Math.max(0, Number(experience) || 0);
  return Math.min(MAX_LEVEL, Math.floor(safeXp / XP_PER_LEVEL) + 1);
}

export function getAvailableExperience(user) {
  const total = Math.max(0, Number(user?.experience) || 0);
  const spent = Math.max(0, Number(user?.spent_experience) || 0);
  return Math.max(0, total - spent);
}

export function getDisplayName(user) {
  const first = String(user?.first_name || "").trim();
  const last = String(user?.last_name || "").trim();
  return `${first} ${last}`.trim() || user?.email || "User";
}

export function getDisplayRole(user) {
  return String(user?.role_label || user?.role || "").trim() || "engineer";
}

export function getRoleColor(roleLabel = "") {
  const value = String(roleLabel || "").trim().toLowerCase();
  if (!value) return "#94a3b8";
  if (value.includes("admin")) return "#ef4444";
  if (value.includes("manager")) return "#f59e0b";
  if (value.includes("lead")) return "#a78bfa";
  if (value.includes("support")) return "#34d399";
  if (value.includes("engineer")) return "#60a5fa";

  const palette = ["#60a5fa", "#34d399", "#f59e0b", "#f472b6", "#a78bfa", "#ef4444"];
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

export function serializeUser(user) {
  if (!user) return null;
  const displayRole = getDisplayRole(user);
  return {
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    role: user.role,
    role_label: user.role_label || "",
    display_role: displayRole,
    role_color: getRoleColor(displayRole),
    avatar_url: user.avatar_url || "",
    can_edit_wiki: Boolean(user.can_edit_wiki) || user.role === "admin",
    can_delete_wiki: Boolean(user.can_delete_wiki) || user.role === "admin",
    experience: Number(user.experience) || 0,
    spent_experience: Number(user.spent_experience) || 0,
    available_experience: getAvailableExperience(user),
    level: getUserLevel(user.experience),
    nickname_color: user.nickname_color || "",
    badge_icon: user.badge_icon || "",
    created_at: user.created_at,
    display_name: getDisplayName(user),
  };
}
