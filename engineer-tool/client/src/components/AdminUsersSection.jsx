import React, { useEffect, useState } from "react";
import { UsersAPI } from "../api.js";

export default function AdminUsersSection() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState({ first_name: "", last_name: "", role_label: "" });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await UsersAPI.adminList();
      setUsers(data?.users || []);
    } catch (e) {
      setError(e?.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function updatePermissions(user, patch) {
    setSavingId(user.id);
    setError("");
    try {
      const next = await UsersAPI.updatePermissions(user.id, {
        can_edit_wiki: patch.can_edit_wiki,
        can_delete_wiki: patch.can_delete_wiki,
      });
      setUsers((prev) =>
        prev.map((item) => (item.id === user.id ? next.user : item))
      );
    } catch (e) {
      setError(e?.message || "Failed to save permissions");
    } finally {
      setSavingId("");
    }
  }

  async function saveAdminProfile(userId) {
    setSavingId(userId);
    setError("");
    try {
      const next = await UsersAPI.updateAdminProfile(userId, draft);
      setUsers((prev) => prev.map((item) => (item.id === userId ? next.user : item)));
      setEditingId("");
    } catch (e) {
      setError(e?.message || "Failed to save profile");
    } finally {
      setSavingId("");
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Admin users</h2>
        <button onClick={load}>Refresh</button>
      </div>

      {error ? <div style={{ color: "#ff6b6b", fontSize: 13 }}>{error}</div> : null}
      {loading ? <div style={{ opacity: 0.7 }}>Loading...</div> : null}

      <div style={{ display: "grid", gap: 8 }}>
        {users.map((user) => {
          const disabled = user.role === "admin" || savingId === user.id;
          return (
            <div key={user.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 700, color: user.nickname_color || "#e5e7eb" }}>
                    {user.badge_icon ? `${user.badge_icon} ` : ""}
                    {user.display_name}
                  </div>
                  <div style={{ opacity: 0.75, fontSize: 13 }}>{user.email}</div>
                  <div style={{ opacity: 0.75, fontSize: 13, marginTop: 4 }}>
                    Role: <span style={{ color: user.role_color || "#94a3b8", fontWeight: 700 }}>{user.display_role || user.role}</span> | XP: {user.experience} | Level: {user.level}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <button
                    onClick={() => {
                      setEditingId(editingId === user.id ? "" : user.id);
                      setDraft({
                        first_name: user.first_name || "",
                        last_name: user.last_name || "",
                        role_label: user.display_role || user.role || "",
                      });
                    }}
                  >
                    {editingId === user.id ? "Close" : "Edit name/role"}
                  </button>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={!!user.can_edit_wiki}
                      disabled={disabled}
                      onChange={(e) =>
                        updatePermissions(user, {
                          can_edit_wiki: e.target.checked,
                          can_delete_wiki: user.can_delete_wiki,
                        })
                      }
                    />
                    Edit articles
                  </label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={!!user.can_delete_wiki}
                      disabled={disabled}
                      onChange={(e) =>
                        updatePermissions(user, {
                          can_edit_wiki: user.can_edit_wiki,
                          can_delete_wiki: e.target.checked,
                        })
                      }
                    />
                    Delete articles
                  </label>
                </div>
              </div>

              {editingId === user.id ? (
                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8 }}>
                    <input
                      value={draft.first_name}
                      onChange={(e) => setDraft((prev) => ({ ...prev, first_name: e.target.value }))}
                      placeholder="First name"
                    />
                    <input
                      value={draft.last_name}
                      onChange={(e) => setDraft((prev) => ({ ...prev, last_name: e.target.value }))}
                      placeholder="Last name"
                    />
                    <input
                      value={draft.role_label}
                      onChange={(e) => setDraft((prev) => ({ ...prev, role_label: e.target.value }))}
                      placeholder="Role label"
                    />
                    <button onClick={() => saveAdminProfile(user.id)} disabled={savingId === user.id}>
                      Save
                    </button>
                  </div>
                  <div style={{ opacity: 0.7, fontSize: 12 }}>
                    This changes the displayed role name and the user's visible first/last name. Admin permissions stay tied to the internal admin role.
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
