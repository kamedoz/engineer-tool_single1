import React, { useEffect, useState } from "react";
import { HistoryAPI } from "../api.js";

export default function HistorySection({ t }) {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const data = await HistoryAPI.list();
      setEntries(data?.entries || []);
    } catch (e) {
      setError(e?.message || "HTTP error");
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>{t("history")}</h2>
        <button onClick={load}>{t("refresh")}</button>
      </div>
      {error ? <div style={{ color: "#ff6b6b" }}>{error}</div> : null}
      {entries.length === 0 ? <div style={{ opacity: 0.8 }}>{t("noHistory")}</div> : null}
      <div style={{ display: "grid", gap: 8 }}>
        {entries.map((entry) => (
          <div key={entry.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 700 }}>{entry.summary}</div>
                <div style={{ opacity: 0.75, fontSize: 13, marginTop: 4 }}>
                  {t("actor")}: {entry.actor_name} | {t("action")}: {entry.action}
                </div>
                {entry.details ? <div style={{ opacity: 0.75, fontSize: 13, marginTop: 4 }}>{t("details")}: {entry.details}</div> : null}
              </div>
              <div style={{ opacity: 0.75, fontSize: 12 }}>{new Date(entry.created_at).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
