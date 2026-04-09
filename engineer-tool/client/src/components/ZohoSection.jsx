import React, { useEffect, useMemo, useState } from "react";
import { TicketsAPI, UsersAPI, ZohoAPI } from "../api.js";

function fmtISODateInput(value) {
  const d = value instanceof Date ? value : new Date(value);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDuration(totalSeconds) {
  const safe = Math.max(0, Number(totalSeconds) || 0);
  const hours = String(Math.floor(safe / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((safe % 3600) / 60)).padStart(2, "0");
  const seconds = String(safe % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export default function ZohoSection({ t, onOpenTicket }) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [ticketFilter, setTicketFilter] = useState("open");
  const [ticketSearch, setTicketSearch] = useState("");
  const [zohoStatus, setZohoStatus] = useState({ connected: false, portal_name: "", account_email: "" });
  const [zohoProjects, setZohoProjects] = useState([]);
  const [zohoUsers, setZohoUsers] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [form, setForm] = useState({
    site: "",
    visit_date: fmtISODateInput(new Date()),
    engineer_user_id: "",
    category_id: "",
    issue_id: "",
    description: "",
    zoho_project_id: "",
    zoho_project_name: "",
    zoho_task_id: "",
    zoho_task_key: "",
    zoho_task_name: "",
    zoho_owner_id: "",
    zoho_owner_name: "",
  });

  const visibleTickets = useMemo(() => {
    const query = ticketSearch.trim().toLowerCase();
    return tickets.filter((ticket) => {
      if ((ticket.status || "open").toLowerCase() !== ticketFilter) return false;
      if (!query) return true;
      return [
        ticket.site || "",
        ticket.description || "",
        ticket.zoho_project_name || "",
        ticket.zoho_task_name || "",
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [ticketFilter, ticketSearch, tickets]);

  async function refreshBaseData() {
    setLoading(true);
    setError("");
    try {
      const [usersData, ticketData, zohoData] = await Promise.all([
        UsersAPI.list(),
        TicketsAPI.list(),
        ZohoAPI.status(),
      ]);
      setUsers(usersData?.users || usersData || []);
      setTickets(ticketData?.tickets || ticketData || []);
      setZohoStatus(zohoData || { connected: false, portal_name: "", account_email: "" });

      if (zohoData?.connected) {
        const projectsData = await ZohoAPI.projects();
        setZohoProjects(projectsData?.projects || []);
      } else {
        setZohoProjects([]);
        setZohoUsers([]);
      }
    } catch (e) {
      setError(e?.message || "HTTP error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshBaseData();
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    async function loadProjectUsers() {
      if (!form.zoho_project_id) {
        setZohoUsers([]);
        return;
      }
      try {
        const data = await ZohoAPI.users(form.zoho_project_id);
        setZohoUsers(data?.users || []);
      } catch (e) {
        setZohoUsers([]);
        setError(e?.message || "Failed to load Zoho users");
      }
    }
    loadProjectUsers();
  }, [form.zoho_project_id]);

  async function connectZoho() {
    try {
      const data = await ZohoAPI.connectUrl();
      window.location.href = data.url;
    } catch (e) {
      setError(e?.message || "Failed to start Zoho connection");
    }
  }

  async function createTask() {
    if (!form.site.trim()) {
      setError("Object name is required");
      return;
    }
    if (form.zoho_project_id && !form.zoho_task_name.trim()) {
      setError("Zoho task name is required");
      return;
    }
    try {
      await TicketsAPI.create({
        ...form,
        engineer_user_id: form.engineer_user_id || null,
        issue_id: null,
        category_id: null,
        description: "",
        zoho_owner_id: form.zoho_owner_id || null,
        zoho_owner_name: form.zoho_owner_name || null,
      });
      setForm((prev) => ({
        ...prev,
        zoho_task_id: "",
        zoho_task_key: "",
        zoho_task_name: "",
      }));
      await refreshBaseData();
    } catch (e) {
      setError(e?.message || "Failed to create task");
    }
  }

  async function updateTicket(ticketId, updater) {
    setTickets((prev) => prev.map((item) => (item.id === ticketId ? { ...item, ...updater } : item)));
  }

  async function startTimer(ticketId) {
    try {
      const data = await TicketsAPI.startTimer(ticketId);
      await updateTicket(ticketId, data?.ticket || data);
    } catch (e) {
      setError(e?.message || "Timer start error");
    }
  }

  async function stopTimer(ticketId) {
    try {
      const data = await TicketsAPI.stopTimer(ticketId);
      await updateTicket(ticketId, data?.ticket || data);
    } catch (e) {
      setError(e?.message || "Timer stop error");
    }
  }

  async function syncAndClose(ticketId) {
    try {
      const data = await TicketsAPI.closeWithZoho(ticketId);
      await updateTicket(ticketId, data?.ticket || data);
    } catch (e) {
      setError(e?.message || "Zoho sync error");
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0 }}>{t("tickets")}</h2>

      <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 700 }}>{t("openInZohoMode")}</div>
            <div style={{ opacity: 0.75, fontSize: 13, marginTop: 4 }}>{t("zohoSectionIntro")}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={refreshBaseData}>{t("refresh")}</button>
            {!zohoStatus.connected ? <button onClick={connectZoho}>{t("connectZoho")}</button> : null}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700 }}>{t("zohoPortal")}:</span>
          <span>{zohoStatus.portal_name || "simplehomebyliis"}</span>
          <span style={{ opacity: 0.75 }}>
            {zohoStatus.connected ? `${t("zohoConnected")}${zohoStatus.account_email ? `: ${zohoStatus.account_email}` : ""}` : t("zohoNotConnected")}
          </span>
        </div>
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{t("createAndSyncTask")}</div>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>1. Выберите проект из Zoho</div>
            <div className="grid-ticket-form">
              <select
                value={form.zoho_project_id}
                onChange={(e) => {
                  const project = zohoProjects.find((item) => item.id === e.target.value);
                  setForm((prev) => ({
                    ...prev,
                    zoho_project_id: e.target.value,
                    zoho_project_name: project?.name || "",
                    site: project?.name || "",
                    zoho_task_id: "",
                    zoho_task_key: "",
                    zoho_task_name: "",
                    zoho_owner_id: "",
                    zoho_owner_name: "",
                  }));
                }}
                disabled={!zohoStatus.connected}
              >
                <option value="">{t("chooseZohoProject")}</option>
                {zohoProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
              <input type="date" value={form.visit_date} onChange={(e) => setForm((prev) => ({ ...prev, visit_date: e.target.value }))} />
            </div>
          </div>

          <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>2. Назначьте исполнителя из Zoho</div>
            <select
              value={form.zoho_owner_id}
              onChange={(e) => {
                const owner = zohoUsers.find((item) => item.id === e.target.value);
                setForm((prev) => ({
                  ...prev,
                  zoho_owner_id: e.target.value,
                  zoho_owner_name: owner?.name || "",
                }));
              }}
              disabled={!form.zoho_project_id}
            >
              <option value="">Zoho executor</option>
              {zohoUsers.map((user) => <option key={user.id} value={user.id}>{user.name}{user.email ? ` · ${user.email}` : ""}</option>)}
            </select>
          </div>

          <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>3. Впишите название вашей задачи</div>
            <div className="grid-ticket-form">
              <input value={form.site} onChange={(e) => setForm((prev) => ({ ...prev, site: e.target.value }))} placeholder={t("site")} />
              <input
                value={form.zoho_task_name}
                onChange={(e) => setForm((prev) => ({ ...prev, zoho_task_name: e.target.value, zoho_task_id: "", zoho_task_key: "" }))}
                placeholder="Впишите название вашей задачи"
                disabled={!form.zoho_project_id}
              />
            </div>
          </div>

          <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>4. Создайте и свяжите задачу</div>
            <button onClick={createTask} style={{ width: "100%" }}>{t("createAndSyncTask")}</button>
          </div>
        </div>
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700 }}>{t("zohoTasks")}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={() => setTicketFilter("open")} style={{ fontWeight: 800, opacity: ticketFilter === "open" ? 1 : 0.5 }}>{t("open")}</button>
            <button onClick={() => setTicketFilter("closed")} style={{ fontWeight: 800, opacity: ticketFilter === "closed" ? 1 : 0.5 }}>{t("closed")}</button>
            <input value={ticketSearch} onChange={(e) => setTicketSearch(e.target.value)} placeholder={t("search")} style={{ minWidth: 180 }} />
          </div>
        </div>
        {loading ? <div style={{ opacity: 0.75, marginTop: 10 }}>{t("loading")}</div> : null}
        {visibleTickets.length === 0 ? (
          <div style={{ opacity: 0.8, marginTop: 10 }}>{t("noTickets")}</div>
        ) : (
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {visibleTickets.map((ticket) => {
              const runningSeconds = ticket.timer_started_at
                ? (Number(ticket.timer_elapsed_seconds) || 0) + Math.max(0, Math.floor((now - new Date(ticket.timer_started_at).getTime()) / 1000))
                : Number(ticket.timer_elapsed_seconds) || 0;
              return (
                <div key={ticket.id} onClick={() => onOpenTicket?.(ticket)} style={{ cursor: "pointer", border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 700 }}>{ticket.site || ticket.zoho_task_name || t("localTaskCreated")}</div>
                    <div style={{ fontWeight: 800, color: (ticket.status || "open") === "open" ? "#3ee37a" : "#ff4d4d" }}>{ticket.status || "open"}</div>
                  </div>
                  <div style={{ marginTop: 6, opacity: 0.85, fontSize: 13, display: "grid", gap: 2 }}>
                    <div>{t("linkedZohoProject")}: {ticket.zoho_project_name || "—"}</div>
                    <div>{t("linkedZohoTask")}: {ticket.zoho_task_key ? `${ticket.zoho_task_key} · ` : ""}{ticket.zoho_task_name || "—"}</div>
                    <div>Zoho executor: {ticket.zoho_owner_name || "—"}</div>
                    <div>{t("zohoSyncStatus")}: {ticket.zoho_sync_status || "local_only"}</div>
                    <div>{t("timer")}: {formatDuration(runningSeconds)}</div>
                  </div>
                  <div style={{ marginTop: 6, opacity: 0.92, wordBreak: "break-word" }}>
                    {(ticket.description || "").slice(0, 180)}{(ticket.description || "").length > 180 ? "..." : ""}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                    {ticket.timer_started_at ? (
                      <button onClick={(e) => { e.stopPropagation(); stopTimer(ticket.id); }}>{t("stopTimer")}</button>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); startTimer(ticket.id); }}>{t("startTimer")}</button>
                    )}
                    {ticket.zoho_project_id && (ticket.status || "open") !== "closed" ? (
                      <button onClick={(e) => { e.stopPropagation(); syncAndClose(ticket.id); }}>{t("syncAndCloseZoho")}</button>
                    ) : null}
                    {(ticket.status || "open") === "closed" ? (
                      <button onClick={(e) => { e.stopPropagation(); TicketsAPI.downloadReport(ticket.id).then((blob) => {
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `ticket_${ticket.id}.pdf`;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        setTimeout(() => URL.revokeObjectURL(url), 2000);
                      }).catch((err) => setError(err?.message || "PDF download error")); }}>PDF</button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {error ? <div style={{ color: "#ff6b6b", fontSize: 13 }}>{error}</div> : null}
    </div>
  );
}
