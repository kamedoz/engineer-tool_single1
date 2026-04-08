import React, { useEffect, useState } from "react";
import { DashboardAPI } from "../api.js";

export default function DashboardSection({ t }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      setData(await DashboardAPI.get());
    } catch (e) {
      setError(e?.message || "HTTP error");
    }
  }

  useEffect(() => { load(); }, []);

  const cards = [
    { label: t("openTickets"), value: data?.open_tickets ?? 0 },
    { label: t("closedToday"), value: data?.closed_today ?? 0 },
    { label: t("articles"), value: data?.knowledge_articles ?? 0 },
    { label: t("unread"), value: data?.unread_notifications ?? 0 },
    { label: t("recentComments"), value: data?.recent_comments ?? 0 },
  ];

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>{t("dashboard")}</h2>
        <button onClick={load}>{t("refresh")}</button>
      </div>
      <div style={{ opacity: 0.8 }}>{t("dashboardIntro")}</div>
      {error ? <div style={{ color: "#ff6b6b" }}>{error}</div> : null}
      <div className="grid-2col">
        {cards.map((card) => (
          <div key={card.label} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
            <div style={{ opacity: 0.75, fontSize: 13 }}>{card.label}</div>
            <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>{card.value}</div>
          </div>
        ))}
      </div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>{t("topContributors")}</div>
        <div style={{ display: "grid", gap: 8 }}>
          {(data?.top_contributors || []).map((user, index) => (
            <div key={user.id || index} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>{index + 1}. {`${user.first_name || ""} ${user.last_name || ""}`.trim() || user.email}</div>
              <div>{user.experience} XP</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
