import React, { useRef, useState } from "react";
import { UsersAPI } from "../api.js";

const COLOR_OPTIONS = [
  "#ffffff",
  "#e5e7eb",
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

const BADGE_OPTIONS = ["", "★", "⚙", "🛠", "📘", "🚀", "🔥", "💡", "🧠", "🧩", "🛰", "🎯", "🏆"];
const ADMIN_BADGE_OPTIONS = ["👑", "🛡", "⚡", "🔱", "☄"];

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ProfileSection({ me, onMeRefresh, t }) {
  const user = me?.user;
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [nicknameColor, setNicknameColor] = useState(user?.nickname_color || "#e5e7eb");
  const [badgeIcon, setBadgeIcon] = useState(user?.badge_icon || "");
  const inputRef = useRef(null);

  if (!user) return null;

  const visibleBadges = user.role === "admin" ? [...BADGE_OPTIONS, ...ADMIN_BADGE_OPTIONS] : BADGE_OPTIONS;

  async function handleAvatarChange(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file");
      return;
    }
    if (file.size > 1024 * 1024) {
      setError("Avatar must be under 1 MB");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const avatar = await toBase64(file);
      await UsersAPI.updateAvatar(avatar);
      await onMeRefresh?.();
    } catch (e) {
      setError(e?.message || "Failed to upload avatar");
    } finally {
      setSaving(false);
    }
  }

  async function saveCustomization() {
    setSaving(true);
    setError("");
    try {
      await UsersAPI.customize({
        nickname_color: nicknameColor,
        badge_icon: badgeIcon,
      });
      await onMeRefresh?.();
    } catch (e) {
      setError(e?.message || "Failed to save customization");
    } finally {
      setSaving(false);
    }
  }

  const nextLevelXp = Math.min(100, user.level) * 20;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0 }}>{t("profile")}</h2>

      <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, display: "grid", gap: 14 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div
            style={{
              width: 84,
              height: 84,
              borderRadius: "50%",
              overflow: "hidden",
              border: "1px solid var(--border)",
              background: "var(--card2)",
              display: "grid",
              placeItems: "center",
              fontSize: 28,
            }}
          >
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span>{user.display_name?.slice(0, 1)?.toUpperCase() || "U"}</span>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: user.nickname_color || "#e5e7eb" }}>
              {user.badge_icon ? `${user.badge_icon} ` : ""}
              {user.display_name}
            </div>
            <div style={{ opacity: 0.75, marginTop: 4 }}>{user.email}</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8, fontSize: 14 }}>
              <span>{t("actor")}: <span style={{ color: user.role_color || "#ffffff", fontWeight: 700 }}>{user.display_role || user.role}</span></span>
              <span>Level: {user.level}/100</span>
              <span>Total XP: {user.experience}</span>
              <span>Available XP: {user.available_experience}</span>
            </div>
          </div>

          <div>
            <button onClick={() => inputRef.current?.click()} disabled={saving}>
              Upload avatar
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => handleAvatarChange(e.target.files?.[0])}
            />
          </div>
        </div>

        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Progress</div>
          <div style={{ height: 10, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.min(100, ((user.experience % 20) / 20) * 100)}%`,
                height: "100%",
                background: "linear-gradient(90deg, #34d399, #60a5fa)",
              }}
            />
          </div>
          <div style={{ marginTop: 8, opacity: 0.75, fontSize: 13 }}>
            One article gives 5 XP. Each 20 XP raises your level until level 100.
            {user.level < 100 ? ` Next level at ${nextLevelXp} XP.` : " Max level reached."}
          </div>
        </div>

        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, display: "grid", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700 }}>Customization shop</div>
            <div style={{ opacity: 0.75, fontSize: 13, marginTop: 4 }}>
              Nickname color costs 20 XP. Badge costs 100 XP. Admin receives both for free and has exclusive badges.
            </div>
          </div>

          <div>
            <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 8 }}>Nickname color</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {COLOR_OPTIONS.map((color) => (
                <button
                  key={color}
                  onClick={() => setNicknameColor(color)}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    padding: 0,
                    border: nicknameColor === color ? "2px solid #fff" : "1px solid var(--border)",
                    background: color,
                  }}
                  title={color}
                />
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 8 }}>Badge icon</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {visibleBadges.map((badge) => (
                <button
                  key={badge || "none"}
                  onClick={() => setBadgeIcon(badge)}
                  style={{
                    minWidth: 48,
                    height: 40,
                    border: badgeIcon === badge ? "2px solid #60a5fa" : "1px solid var(--border)",
                    background: "transparent",
                  }}
                >
                  {badge || "None"}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={saveCustomization} disabled={saving}>
              {saving ? "Saving..." : "Save customization"}
            </button>
          </div>
        </div>

        {error ? <div style={{ color: "#ff6b6b", fontSize: 13 }}>{error}</div> : null}
      </div>
    </div>
  );
}
