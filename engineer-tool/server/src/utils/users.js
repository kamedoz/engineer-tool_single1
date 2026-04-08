export const XP_PER_ARTICLE = 5;
export const XP_PER_LEVEL = 20;
export const MAX_LEVEL = 100;
export const COLOR_CHANGE_COST = 20;
export const BADGE_CHANGE_COST = 100;

export const ALLOWED_NICKNAME_COLORS = [
  "",
  "#e5e7eb",
  "#ffffff",
  "#60a5fa",
  "#38bdf8",
  "#22d3ee",
  "#34d399",
  "#10b981",
  "#84cc16",
  "#f59e0b",
  "#fbbf24",
  "#fb7185",
  "#f472b6",
  "#ec4899",
  "#a78bfa",
  "#8b5cf6",
  "#f87171",
  "#ef4444",
  "#f97316",
];

export const BASE_BADGE_ICONS = [
  "",
  "★",
  "⚙",
  "🛠",
  "📘",
  "🚀",
  "🔥",
  "💡",
  "🧠",
  "🧩",
  "🛰",
  "🎯",
  "🏆",
];

export const ADMIN_BADGE_ICONS = [
  "👑",
  "🛡",
  "⚡",
  "🔱",
  "☄",
];

export const ALLOWED_BADGE_ICONS = [...BASE_BADGE_ICONS, ...ADMIN_BADGE_ICONS];

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
  if (value.includes("admin")) return "#ef4444";
  return "#ffffff";
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
