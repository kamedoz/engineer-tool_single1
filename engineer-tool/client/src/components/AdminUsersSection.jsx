import React, { useEffect, useState } from "react";
import { UsersAPI } from "../api.js";

export default function AdminUsersSection({ t }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState({ first_name: "", last_name: "", role_label: "" });
  const [createDraft, setCreateDraft] = useState({ email: "", password: "" });
  const [passwordDrafts, setPasswordDrafts] = useState({});

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

  async function deleteUser(user) {
    // eslint-disable-next-line no-restricted-globals
    if (!confirm(`Delete user ${user.display_name || user.email}?`)) return;
    setSavingId(user.id);
    setError("");
    try {
      await UsersAPI.remove(user.id);
      setUsers((prev) => prev.filter((item) => item.id !== user.id));
      if (editingId === user.id) setEditingId("");
    } catch (e) {
      setError(e?.message || "Failed to delete user");
    } finally {
      setSavingId("");
    }
  }

  async function createUser() {
    if (!createDraft.email.trim() || !createDraft.password) {
      setError("Email and password are required");
      return;
    }
    setSavingId("create");
    setError("");
    try {
      const next = await UsersAPI.adminCreate({
        email: createDraft.email.trim(),
        password: createDraft.password,
      });
      setUsers((prev) => [next.user, ...prev]);
      setCreateDraft({ email: "", password: "" });
    } catch (e) {
      setError(e?.message || "Failed to create user");
    } finally {
      setSavingId("");
    }
  }

  async function savePassword(user) {
    const nextPassword = String(passwordDrafts[user.id] || "");
    if (!nextPassword) {
      setError("Password is required");
      return;
    }
    setSavingId(`password:${user.id}`);
    setError("");
    try {
      await UsersAPI.updateAdminPassword(user.id, nextPassword);
      setPasswordDrafts((prev) => ({ ...prev, [user.id]: "" }));
    } catch (e) {
      setError(e?.message || "Failed to update password");
    } finally {
      setSavingId("");
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>{t("users")}</h2>
        <button onClick={load}>{t("refresh")}</button>
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 700 }}>Create new user</div>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr auto", gap: 8 }}>
          <input
            type="email"
            value={createDraft.email}
            onChange={(e) => setCreateDraft((prev) => ({ ...prev, email: e.target.value }))}
            placeholder="Email"
          />
          <input
            type="password"
            value={createDraft.password}
            onChange={(e) => setCreateDraft((prev) => ({ ...prev, password: e.target.value }))}
            placeholder="Password"
          />
          <button onClick={createUser} disabled={savingId === "create"}>
            Create user
          </button>
        </div>
        <div style={{ opacity: 0.7, fontSize: 12 }}>
          New users are created only by admin. They can sign in with the email and password you set here.
        </div>
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
                  {user.role !== "admin" ? (
                    <button
                      onClick={() => deleteUser(user)}
                      disabled={savingId === user.id}
                      style={{ background: "rgba(184,74,90,.18)", borderColor: "rgba(184,74,90,.35)" }}
                    >
                      Delete user
                    </button>
                  ) : null}
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
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                    <input
                      type="password"
                      value={passwordDrafts[user.id] || ""}
                      onChange={(e) => setPasswordDrafts((prev) => ({ ...prev, [user.id]: e.target.value }))}
                      placeholder="New password"
                    />
                    <button onClick={() => savePassword(user)} disabled={savingId === `password:${user.id}`}>
                      Change password
                    </button>
                  </div>
                  <div style={{ opacity: 0.7, fontSize: 12 }}>
                    This changes the displayed role name, the visible first/last name, and lets you set a new password. Admin permissions stay tied to the internal admin role.
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
