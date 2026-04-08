import React, { useEffect, useState } from "react";
import { NotificationsAPI } from "../api.js";

export default function NotificationsSection({ t }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const data = await NotificationsAPI.list();
      setItems(data?.notifications || []);
    } catch (e) {
      setError(e?.message || "HTTP error");
    }
  }

  useEffect(() => { load(); }, []);

  async function markRead(id) {
    await NotificationsAPI.markRead(id);
    setItems((prev) => prev.map((item) => item.id === id ? { ...item, is_read: true } : item));
  }

  async function markAllRead() {
    await NotificationsAPI.markAllRead();
    setItems((prev) => prev.map((item) => ({ ...item, is_read: true })));
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>{t("notifications")}</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load}>{t("refresh")}</button>
          <button onClick={markAllRead}>{t("markAllRead")}</button>
        </div>
      </div>
      {error ? <div style={{ color: "#ff6b6b" }}>{error}</div> : null}
      {items.length === 0 ? <div style={{ opacity: 0.8 }}>{t("noNotifications")}</div> : null}
      <div style={{ display: "grid", gap: 8 }}>
        {items.map((item) => (
          <div key={item.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, opacity: item.is_read ? 0.72 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700 }}>{item.title}</div>
                <div style={{ marginTop: 4 }}>{item.body}</div>
              </div>
              <div style={{ textAlign: "right", fontSize: 12, opacity: 0.75 }}>
                <div>{new Date(item.created_at).toLocaleString()}</div>
                {!item.is_read ? <button onClick={() => markRead(item.id)} style={{ marginTop: 8 }}>{t("markRead")}</button> : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
