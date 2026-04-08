import React, { useEffect, useState } from "react";
import { UsersAPI } from "../api.js";

function UserBadge({ user }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div
        style={{
          width: 46,
          height: 46,
          borderRadius: "50%",
          overflow: "hidden",
          border: "1px solid var(--border)",
          background: "var(--card2)",
          display: "grid",
          placeItems: "center",
          fontWeight: 700,
        }}
      >
        {user.avatar_url ? (
          <img src={user.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <span>{user.display_name?.slice(0, 1)?.toUpperCase() || "U"}</span>
        )}
      </div>
      <div>
        <div style={{ fontWeight: 700, color: user.nickname_color || "#e5e7eb" }}>
          {user.badge_icon ? `${user.badge_icon} ` : ""}
          {user.display_name}
        </div>
        <div style={{ opacity: 0.9, fontSize: 13, color: user.role_color || "#94a3b8" }}>{user.display_role || user.role}</div>
      </div>
    </div>
  );
}

export default function LeaderboardSection() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await UsersAPI.leaderboard();
      setUsers(data?.users || []);
    } catch (e) {
      setError(e?.message || "Failed to load leaderboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Leaderboard</h2>
        <button onClick={load}>Refresh</button>
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
        <div style={{ opacity: 0.75, fontSize: 13 }}>
          Public ranking by total experience. Each article gives 5 XP. Every 20 XP increases level.
        </div>
      </div>

      {error ? <div style={{ color: "#ff6b6b", fontSize: 13 }}>{error}</div> : null}
      {loading ? <div style={{ opacity: 0.7 }}>Loading...</div> : null}

      <div style={{ display: "grid", gap: 8 }}>
        {users.map((user, index) => (
          <div
            key={user.id}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 12,
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              gap: 12,
              alignItems: "center",
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 800, width: 34, textAlign: "center" }}>#{index + 1}</div>
            <UserBadge user={user} />
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 800 }}>{user.experience} XP</div>
              <div style={{ opacity: 0.75, fontSize: 13 }}>Level {user.level}</div>
            </div>
          </div>
        ))}
        {!loading && users.length === 0 ? <div style={{ opacity: 0.7 }}>No users yet.</div> : null}
      </div>
    </div>
  );
}
