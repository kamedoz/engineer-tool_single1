import React, { useEffect, useState } from "react";
import { DashboardAPI } from "../api.js";

function formatDuration(totalSeconds) {
  const safe = Math.max(0, Number(totalSeconds) || 0);
  const hours = String(Math.floor(safe / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((safe % 3600) / 60)).padStart(2, "0");
  const seconds = String(safe % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export default function DashboardSection({ t }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());

  async function load() {
    setError("");
    try {
      setData(await DashboardAPI.get());
    } catch (e) {
      setError(e?.message || "HTTP error");
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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
      <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Active Zoho tasks</div>
        {(data?.active_zoho_tasks || []).length === 0 ? (
          <div style={{ opacity: 0.75 }}>No active Zoho tasks.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {(data?.active_zoho_tasks || []).map((task) => {
              const runningSeconds = task.timer_started_at
                ? (Number(task.timer_elapsed_seconds) || 0) + Math.max(0, Math.floor((now - new Date(task.timer_started_at).getTime()) / 1000))
                : Number(task.timer_elapsed_seconds) || 0;
              const engineerName = `${task.engineer_first_name || ""} ${task.engineer_last_name || ""}`.trim() || task.engineer_email || "Unassigned";
              return (
                <div key={task.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 700 }}>{task.site || task.zoho_task_name || "Zoho task"}</div>
                    <div style={{ color: task.timer_started_at ? "#3ee37a" : "inherit", fontWeight: 700 }}>
                      {formatDuration(runningSeconds)}
                    </div>
                  </div>
                  <div style={{ opacity: 0.8, fontSize: 13, marginTop: 6 }}>
                    {task.zoho_project_name || "Zoho project"}{task.zoho_task_key ? ` · ${task.zoho_task_key}` : ""}{task.zoho_task_name ? ` · ${task.zoho_task_name}` : ""}
                  </div>
                  <div style={{ opacity: 0.72, fontSize: 13, marginTop: 4 }}>
                    {engineerName}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
