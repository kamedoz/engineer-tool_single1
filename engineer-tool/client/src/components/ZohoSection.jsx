import React, { useEffect, useMemo, useState } from "react";
import { TicketsAPI, UsersAPI, CategoriesAPI, IssuesAPI, ZohoAPI } from "../api.js";

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
  const [categories, setCategories] = useState([]);
  const [issues, setIssues] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [ticketFilter, setTicketFilter] = useState("open");
  const [ticketSearch, setTicketSearch] = useState("");
  const [zohoStatus, setZohoStatus] = useState({ connected: false, portal_name: "", account_email: "" });
  const [zohoProjects, setZohoProjects] = useState([]);
  const [zohoTasks, setZohoTasks] = useState([]);
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
  });

  const filteredIssues = useMemo(() => {
    if (!form.category_id) return issues;
    return issues.filter((item) => String(item.category_id) === String(form.category_id));
  }, [issues, form.category_id]);

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
      const [usersData, categoryData, issueData, ticketData, zohoData] = await Promise.all([
        UsersAPI.list(),
        CategoriesAPI.list(),
        IssuesAPI.list(),
        TicketsAPI.list(),
        ZohoAPI.status(),
      ]);
      setUsers(usersData?.users || usersData || []);
      setCategories(categoryData?.categories || categoryData || []);
      setIssues(issueData?.issues || issueData || []);
      setTickets(ticketData?.tickets || ticketData || []);
      setZohoStatus(zohoData || { connected: false, portal_name: "", account_email: "" });

      if (zohoData?.connected) {
        const projectsData = await ZohoAPI.projects();
        setZohoProjects(projectsData?.projects || []);
      } else {
        setZohoProjects([]);
        setZohoTasks([]);
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
    async function loadTasks() {
      if (!form.zoho_project_id) {
        setZohoTasks([]);
        return;
      }
      try {
        const data = await ZohoAPI.tasks(form.zoho_project_id);
        setZohoTasks(data?.tasks || []);
      } catch (e) {
        setZohoTasks([]);
        setError(e?.message || "Failed to load Zoho tasks");
      }
    }
    loadTasks();
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
    if (!form.category_id && !form.zoho_project_id) {
      setError("category_id is required");
      return;
    }
    if (!form.description.trim()) {
      setError("Problem description is required");
      return;
    }
    try {
      await TicketsAPI.create({
        ...form,
        engineer_user_id: form.engineer_user_id || null,
        issue_id: form.issue_id || null,
        description: form.description.trim(),
      });
      setForm((prev) => ({
        ...prev,
        description: "",
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
        <div className="grid-ticket-form">
          <input value={form.site} onChange={(e) => setForm((prev) => ({ ...prev, site: e.target.value }))} placeholder={t("site")} />
          <input type="date" value={form.visit_date} onChange={(e) => setForm((prev) => ({ ...prev, visit_date: e.target.value }))} />
          <select value={form.engineer_user_id} onChange={(e) => setForm((prev) => ({ ...prev, engineer_user_id: e.target.value }))}>
            <option value="">{t("assigneeOptional")}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.display_name || user.email}</option>
            ))}
          </select>
          <select
            value={form.zoho_project_id}
            onChange={(e) => {
              const project = zohoProjects.find((item) => item.id === e.target.value);
              setForm((prev) => ({
                ...prev,
                zoho_project_id: e.target.value,
                zoho_project_name: project?.name || "",
                zoho_task_id: "",
                zoho_task_key: "",
                zoho_task_name: "",
              }));
            }}
            disabled={!zohoStatus.connected}
          >
            <option value="">{t("chooseZohoProject")}</option>
            {zohoProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <select
            value={form.zoho_task_id}
            onChange={(e) => {
              const task = zohoTasks.find((item) => item.id === e.target.value);
              setForm((prev) => ({
                ...prev,
                zoho_task_id: e.target.value,
                zoho_task_key: task?.key || "",
                zoho_task_name: task?.name || "",
                site: prev.site || task?.name || "",
              }));
            }}
            disabled={!form.zoho_project_id}
          >
            <option value="">{t("chooseZohoTask")}</option>
            {zohoTasks.map((task) => <option key={task.id} value={task.id}>{task.key ? `${task.key} · ` : ""}{task.name}</option>)}
          </select>
          <select value={form.category_id} onChange={(e) => setForm((prev) => ({ ...prev, category_id: e.target.value, issue_id: "" }))}>
            <option value="">{t("categoryRequired")}</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
          <select value={form.issue_id} onChange={(e) => setForm((prev) => ({ ...prev, issue_id: e.target.value }))}>
            <option value="">{t("issueTemplateOptional")}</option>
            {filteredIssues.map((issue) => <option key={issue.id} value={issue.id}>{issue.title}</option>)}
          </select>
          <button onClick={createTask}>{t("createAndSyncTask")}</button>
        </div>
        <textarea
          style={{ marginTop: 10, width: "100%", minHeight: 110 }}
          value={form.description}
          onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
          placeholder={t("describeProblem")}
        />
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
                ? (Number(ticket.timer_elapsed_seconds) || 0) + Math.max(0, Math.floor((Date.now() - new Date(ticket.timer_started_at).getTime()) / 1000))
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
