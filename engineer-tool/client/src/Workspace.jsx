import React, { useEffect, useMemo, useState } from "react";
import {
  CategoriesAPI,
  IssuesAPI,
  TicketsAPI,
  UsersAPI,
  ChatAPI,
} from "./api.js";

function fmtISODateInput(value) {
  const d = value instanceof Date ? value : new Date(value);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeStepsText(stepsText) {
  return (stepsText || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

function Modal({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(920px, 96vw)",
          maxHeight: "86vh",
          overflow: "auto",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 14,
          background: "rgba(10,12,20,0.98)",
          padding: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 18 }}>{title}</div>
          <button onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        <div style={{ marginTop: 12 }}>{children}</div>
      </div>
    </div>
  );
}

function ChecklistBuilder({ value, onChange }) {
  const steps = normalizeStepsText(value);
  const [draft, setDraft] = useState("");

  function commit(nextSteps) {
    onChange(nextSteps.join("\n"));
  }

  function addStep() {
    const t = (draft || "").trim();
    if (!t) return;
    commit([...steps, t]);
    setDraft("");
  }

  function removeAt(idx) {
    const next = steps.filter((_, i) => i !== idx);
    commit(next);
  }

  function move(idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    const tmp = next[idx];
    next[idx] = next[j];
    next[j] = tmp;
    commit(next);
  }

  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        padding: 10,
        marginBottom: 8,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 8 }}>
        Проверка по шагам (чеклист)
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Добавь шаг и нажми Enter…"
          style={{ flex: 1 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addStep();
            }
          }}
        />
        <button onClick={addStep}>Добавить</button>
      </div>

      {steps.length === 0 ? (
        <div style={{ opacity: 0.8, fontSize: 13 }}>
          Шагов пока нет. Добавь первый шаг выше.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {steps.map((t, idx) => (
            <div
              key={`${idx}-${t}`}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 8,
                alignItems: "center",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 10,
                padding: 8,
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <div style={{ opacity: 0.7, width: 22, textAlign: "right" }}>
                  {idx + 1}.
                </div>
                <div>{t}</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => move(idx, -1)} disabled={idx === 0} title="Up">
                  ↑
                </button>
                <button
                  onClick={() => move(idx, +1)}
                  disabled={idx === steps.length - 1}
                  title="Down"
                >
                  ↓
                </button>
                <button onClick={() => removeAt(idx)} title="Remove">
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChecklistRunner({ stepsText }) {
  const steps = useMemo(() => normalizeStepsText(stepsText), [stepsText]);
  const [results, setResults] = useState(() => steps.map(() => null));
  const [resolvedAt, setResolvedAt] = useState(null);

  useEffect(() => {
    setResults(steps.map(() => null));
    setResolvedAt(null);
  }, [stepsText, steps.length]);

  function setResult(idx, val) {
    if (resolvedAt !== null) return;
    setResults((prev) => {
      const next = [...prev];
      next[idx] = val;
      return next;
    });
    if (val === true) setResolvedAt(idx);
  }

  const checkedCount = results.filter((x) => x !== null).length;

  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        padding: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ fontWeight: 800 }}>Чеклист</div>
        <div style={{ opacity: 0.8, fontSize: 13 }}>
          {resolvedAt !== null
            ? `Решено на шаге ${resolvedAt + 1} ✅`
            : `Проверено: ${checkedCount}/${steps.length}`}
        </div>
      </div>

      {steps.length === 0 ? (
        <div style={{ opacity: 0.85, marginTop: 8 }}>В шаблоне нет шагов.</div>
      ) : (
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {steps.map((t, idx) => {
            const r = results[idx];
            const disabled = resolvedAt !== null && idx !== resolvedAt;
            return (
              <div
                key={`${idx}-${t}`}
                style={{
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10,
                  padding: 10,
                  opacity: disabled ? 0.55 : 1,
                }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ opacity: 0.7, width: 22, textAlign: "right" }}>
                    {idx + 1}.
                  </div>
                  <div style={{ flex: 1 }}>{t}</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button
                      onClick={() => setResult(idx, true)}
                      disabled={disabled}
                      title="Помогло"
                    >
                      ✅
                    </button>
                    <button
                      onClick={() => setResult(idx, false)}
                      disabled={disabled}
                      title="Не помогло"
                    >
                      ❌
                    </button>
                  </div>
                </div>
                {r === true ? (
                  <div style={{ marginTop: 8, opacity: 0.9 }}>
                    Помогло — можно закрывать проблему.
                  </div>
                ) : null}
                {r === false ? (
                  <div style={{ marginTop: 8, opacity: 0.85 }}>
                    Не помогло — идём дальше.
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <button
          onClick={() => {
            setResults(steps.map(() => null));
            setResolvedAt(null);
          }}
          disabled={steps.length === 0}
        >
          Сбросить
        </button>
      </div>
    </div>
  );
}

function TicketChecklistRunner({ ticket, steps, onStepResult }) {
  const resolvedAt = useMemo(() => {
    const idx = steps.findIndex((s) => s.result === "pass");
    return idx >= 0 ? idx : null;
  }, [steps]);

  const checkedCount = useMemo(
    () => steps.filter((s) => s.result === "pass" || s.result === "fail").length,
    [steps]
  );

  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontWeight: 800 }}>Чеклист</div>
        <div style={{ opacity: 0.8, fontSize: 13 }}>
          {resolvedAt !== null
            ? `Решено на шаге ${resolvedAt + 1} ✅`
            : `Проверено: ${checkedCount}/${steps.length}`}
        </div>
      </div>

      {steps.length === 0 ? (
        <div style={{ opacity: 0.85, marginTop: 8 }}>В шаблоне нет шагов.</div>
      ) : (
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {steps.map((s, idx) => {
            const disabled = resolvedAt !== null && idx !== resolvedAt;
            const r = s.result;
            return (
              <div
                key={s.id}
                style={{
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10,
                  padding: 10,
                  opacity: disabled ? 0.55 : 1,
                }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ opacity: 0.7, width: 22, textAlign: "right" }}>{idx + 1}.</div>
                  <div style={{ flex: 1 }}>{s.step_text}</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button onClick={() => onStepResult(s, true)} disabled={disabled} title="Помогло">
                      ✅
                    </button>
                    <button onClick={() => onStepResult(s, false)} disabled={disabled} title="Не помогло">
                      ❌
                    </button>
                  </div>
                </div>
                {r === "pass" ? (
                  <div style={{ marginTop: 8, opacity: 0.9 }}>Помогло — можно закрывать заявку.</div>
                ) : null}
                {r === "fail" ? (
                  <div style={{ marginTop: 8, opacity: 0.85 }}>Не помогло — идём дальше.</div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TicketModal({ open, ticket, onClose, onUpdated, setError, downloadPdf }) {
  const [steps, setSteps] = useState([]);
  const [notes, setNotes] = useState([]);
  const [noteDraft, setNoteDraft] = useState("");
  const isClosed = (ticket?.status || "open") === "closed";

  useEffect(() => {
    (async () => {
      if (!open || !ticket?.id) return;
      try {
        let st = await TicketsAPI.steps(ticket.id);
        if ((!st || st.length === 0) && ticket.issue_steps) {
          const list = normalizeStepsText(ticket.issue_steps);
          if (list.length) st = await TicketsAPI.bootstrapSteps(ticket.id, list);
        }
        setSteps(st || []);
        const ns = await TicketsAPI.notes(ticket.id);
        setNotes(ns || []);
      } catch (e) {
        setError?.(e?.message || "HTTP error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ticket?.id]);

  async function onStepResult(step, ok) {
    if (!ticket?.id) return;
    try {
      const updated = await TicketsAPI.updateStep(ticket.id, step.id, ok);
      setSteps((prev) => prev.map((s) => (s.id === step.id ? updated : s)));
    } catch (e) {
      setError?.(e?.message || "HTTP error");
    }
  }

  async function addNote() {
    const txt = (noteDraft || "").trim();
    if (!txt || !ticket?.id) return;
    try {
      await TicketsAPI.addNote(ticket.id, txt);
      setNoteDraft("");
      const ns = await TicketsAPI.notes(ticket.id);
      setNotes(ns || []);
    } catch (e) {
      setError?.(e?.message || "HTTP error");
    }
  }

  async function closeTicket() {
    if (!ticket?.id) return;
    try {
      await TicketsAPI.setStatus(ticket.id, "closed");
      onUpdated?.();
    } catch (e) {
      setError?.(e?.message || "HTTP error");
    }
  }

  return (
    <Modal
      open={open}
      title={ticket ? `Заявка: ${ticket.site || ""}` : "Заявка"}
      onClose={onClose}
    >
      {ticket ? (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 4, opacity: 0.9, fontSize: 13 }}>
            <div><b>ID:</b> {ticket.id}</div>
            <div>
              <b>Status:</b>{" "}
              <span style={{ color: (ticket.status || "open") === "open" ? "#4cd964" : "#ff6b6b" }}>
                {ticket.status || "open"}
              </span>
            </div>
            {ticket.visit_date ? <div><b>Date:</b> {ticket.visit_date}</div> : null}
            {ticket.category_name ? <div><b>Category:</b> {ticket.category_name}</div> : null}
            {ticket.issue_title ? <div><b>Issue:</b> {ticket.issue_title}</div> : null}
            {ticket.engineer_email ? <div><b>Assignee:</b> {ticket.engineer_email}</div> : null}
          </div>

          <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 10 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Описание</div>
            <div style={{ whiteSpace: "pre-wrap", opacity: 0.95 }}>{ticket.description || ""}</div>
          </div>

          <TicketChecklistRunner ticket={ticket} steps={steps} onStepResult={onStepResult} />

          <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 10 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Заметки</div>
            {notes.length === 0 ? (
              <div style={{ opacity: 0.85 }}>Пока нет заметок.</div>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                {notes.map((n) => (
                  <div key={n.id} style={{ opacity: 0.95 }}>
                    • {n.note_text}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Добавь заметку…"
                style={{ flex: 1 }}
              />
              <button onClick={addNote}>Добавить</button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button onClick={() => downloadPdf(ticket)}>Скачать PDF</button>
            <button onClick={closeTicket} disabled={isClosed}>
              Закрыть заявку
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

export default function Workspace({ me, onLogout }) {
  const [tab, setTab] = useState("tickets");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [error, setError] = useState("");
  const [users, setUsers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [issues, setIssues] = useState([]);
  const [activeIssue, setActiveIssue] = useState(null);
  const [isEditingIssue, setIsEditingIssue] = useState(false);
  const [editIssue, setEditIssue] = useState({
    category_id: "",
    title: "",
    description: "",
    steps: "",
    solution: "",
  });

  const [issueSearch, setIssueSearch] = useState("");
  const [issueCategoryFilter, setIssueCategoryFilter] = useState("");

  const [tickets, setTickets] = useState([]);
  const [activeTicket, setActiveTicket] = useState(null);
  const [ticketFilter, setTicketFilter] = useState("open");
  const [ticketSearchOpen, setTicketSearchOpen] = useState("");
  const [ticketSearchClosed, setTicketSearchClosed] = useState("");
  const [ticketForm, setTicketForm] = useState({
    site: "Town House 5 / V",
    visit_date: fmtISODateInput(new Date()),
    engineer_user_id: "",
    category_id: "",
    issue_id: "",
    description: "",
  });

  const [newCategoryName, setNewCategoryName] = useState("");
  const [newIssue, setNewIssue] = useState({
    category_id: "",
    title: "",
    description: "",
    steps: "",
    solution: "",
  });

  const [threads, setThreads] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [messages, setMessages] = useState([]);
  const [chatText, setChatText] = useState("");

  const meLabel = useMemo(() => {
    if (!me?.user) return "• undefined • undefined";
    const u = me.user;
    const name = `${u.first_name || ""} ${u.last_name || ""}`.trim();
    return `• ${name || u.email} • ${u.role || ""}`;
  }, [me]);

  // Закрываем sidebar при смене таба на мобильном
  function switchTab(t) {
    setTab(t);
    setSidebarOpen(false);
  }

  async function refreshAll() {
    setError("");
    try {
      const [u, c, i] = await Promise.all([
        UsersAPI.list(),
        CategoriesAPI.list(),
        IssuesAPI.list(),
      ]);
      setUsers(u?.users || u || []);
      setCategories(c?.categories || c || []);
      setIssues(i?.issues || i || []);
    } catch (e) {
      setError(e?.message || "HTTP error");
    }
  }

  async function refreshTickets() {
    setError("");
    try {
      const t = await TicketsAPI.list();
      setTickets(t?.tickets || t || []);
    } catch (e) {
      setError(e?.message || "HTTP error");
    }
  }

  async function refreshChatThreads() {
    setError("");
    try {
      const t = await ChatAPI.listThreads();
      setThreads(t?.threads || t || []);
    } catch (e) {
      setError(e?.message || "HTTP error");
    }
  }

  async function loadMessages(otherUserId) {
    setError("");
    try {
      const m = await ChatAPI.listMessages(otherUserId);
      setMessages(m?.messages || m || []);
    } catch (e) {
      setError(e?.message || "HTTP error");
    }
  }

  useEffect(() => {
    refreshAll();
    refreshTickets();
    refreshChatThreads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createCategory() {
    setError("");
    const name = newCategoryName.trim();
    if (!name) { setError("Category name is required"); return; }
    try {
      await CategoriesAPI.create(name);
      setNewCategoryName("");
      await refreshAll();
      switchTab("kb");
    } catch (e) {
      setError(e?.message || "HTTP error");
    }
  }

  async function createIssue() {
    setError("");
    if (!newIssue.category_id) { setError("category_id is required"); return; }
    if (!newIssue.title.trim()) { setError("Issue title is required"); return; }
    try {
      await IssuesAPI.create({
        category_id: newIssue.category_id,
        title: newIssue.title.trim(),
        description: newIssue.description?.trim() || "",
        steps: newIssue.steps?.trim() || "",
        solution: newIssue.solution?.trim() || "",
      });
      setNewIssue({ category_id: newIssue.category_id, title: "", description: "", steps: "", solution: "" });
      await refreshAll();
      switchTab("kb");
    } catch (e) {
      setError(e?.message || "HTTP error");
    }
  }

  function openIssue(i) {
    setActiveIssue(i);
    setIsEditingIssue(false);
    setEditIssue({
      category_id: String(i.category_id || ""),
      title: i.title || "",
      description: i.description || "",
      steps: i.steps || "",
      solution: i.solution || "",
    });
  }

  async function saveIssueEdits() {
    if (!activeIssue?.id) return;
    setError("");
    if (!editIssue.category_id) { setError("category_id is required"); return; }
    if (!editIssue.title.trim()) { setError("title is required"); return; }
    try {
      await IssuesAPI.update(activeIssue.id, {
        category_id: editIssue.category_id,
        title: editIssue.title.trim(),
        description: editIssue.description || "",
        steps: editIssue.steps || "",
        solution: editIssue.solution || "",
      });
      await refreshAll();
      setIsEditingIssue(false);
      setActiveIssue(null);
      setTimeout(() => {
        const updated = (issues || []).find((x) => x.id === activeIssue.id);
        if (updated) openIssue(updated);
      }, 0);
    } catch (e) {
      setError(e?.message || "HTTP error");
    }
  }

  async function deleteIssue() {
    if (!activeIssue?.id) return;
    // eslint-disable-next-line no-restricted-globals
    if (!confirm("Удалить этот шаблон?")) return;
    setError("");
    try {
      await IssuesAPI.remove(activeIssue.id);
      setActiveIssue(null);
      setIsEditingIssue(false);
      await refreshAll();
    } catch (e) {
      setError(e?.message || "HTTP error");
    }
  }

  async function createTicket() {
    setError("");
    if (!ticketForm.category_id) { setError("category_id is required"); return; }
    if (!ticketForm.description.trim()) { setError("Описание проблемы обязательно"); return; }
    try {
      await TicketsAPI.create({
        site: ticketForm.site,
        visit_date: ticketForm.visit_date,
        engineer_user_id: ticketForm.engineer_user_id || null,
        category_id: ticketForm.category_id,
        issue_id: ticketForm.issue_id || null,
        description: ticketForm.description.trim(),
      });
      setTicketForm((p) => ({ ...p, description: "" }));
      await refreshTickets();
      switchTab("tickets");
    } catch (e) {
      setError(e?.message || "HTTP error");
    }
  }

  async function sendMessage() {
    setError("");
    const text = chatText.trim();
    if (!selectedUserId || !text) return;
    try {
      await ChatAPI.send(selectedUserId, text);
      setChatText("");
      await loadMessages(selectedUserId);
      await refreshChatThreads();
    } catch (e) {
      setError(e?.message || "HTTP error");
    }
  }

  async function downloadTicketPdf(ticket) {
    try {
      const blob = await TicketsAPI.downloadReport(ticket.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ticket_${ticket.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      setError(e?.message || "PDF download error");
    }
  }

  const filteredIssuesForCategory = useMemo(() => {
    const cid = ticketForm.category_id || "";
    if (!cid) return issues;
    return issues.filter((x) => String(x.category_id) === String(cid));
  }, [issues, ticketForm.category_id]);

  const ticketSearch = ticketFilter === "open" ? ticketSearchOpen : ticketSearchClosed;
  const setTicketSearch = (v) => {
    if (ticketFilter === "open") setTicketSearchOpen(v);
    else setTicketSearchClosed(v);
  };

  const visibleTickets = useMemo(() => {
    const q = (ticketSearch || "").trim().toLowerCase();
    return tickets.filter((t) => {
      const st = (t.status || "open").toLowerCase();
      if (ticketFilter && st !== ticketFilter) return false;
      if (!q) return true;
      return (
        (t.site || "").toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q) ||
        (t.category_name || "").toLowerCase().includes(q) ||
        (t.issue_title || "").toLowerCase().includes(q)
      );
    });
  }, [tickets, ticketFilter, ticketSearch]);

  const visibleIssues = useMemo(() => {
    const q = (issueSearch || "").trim().toLowerCase();
    return issues.filter((i) => {
      if (issueCategoryFilter && String(i.category_id) !== String(issueCategoryFilter)) return false;
      if (!q) return true;
      return (
        (i.title || "").toLowerCase().includes(q) ||
        (i.description || "").toLowerCase().includes(q) ||
        (i.solution || "").toLowerCase().includes(q)
      );
    });
  }, [issues, issueSearch, issueCategoryFilter]);

  // Название текущей вкладки для топбара
  const tabLabel = tab === "tickets" ? "Заявки" : tab === "kb" ? "База проблем" : "Чат";

  return (
    <div className="ws-root">

      {/* Мобильный топбар — виден только на mobile через CSS */}
      <div className="ws-topbar">
        <button
          className="ws-hamburger"
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label="Открыть меню"
        >
          <span />
          <span />
          <span />
        </button>
        <div style={{ fontWeight: 700, flex: 1 }}>Engineer Tool</div>
        <div style={{ opacity: 0.75, fontSize: 13 }}>{tabLabel}</div>
      </div>

      {/* Overlay для закрытия sidebar по клику вне */}
      <div
        className={`ws-overlay${sidebarOpen ? " open" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      <div className="ws-layout">
        {/* Sidebar */}
        <div className={`ws-sidebar${sidebarOpen ? " open" : ""}`}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Engineer Tool</div>
          <div style={{ opacity: 0.85, fontSize: 13, marginBottom: 16 }}>{meLabel}</div>

          <div style={{ display: "grid", gap: 8 }}>
            <button onClick={() => switchTab("tickets")}>Заявки</button>
            <button onClick={() => switchTab("kb")}>Решения / База проблем</button>
            <button
              onClick={() => {
                switchTab("chat");
                refreshChatThreads();
              }}
            >
              Чат
            </button>
            <button onClick={onLogout}>Выйти</button>
          </div>

          {error ? (
            <div style={{ marginTop: 10, color: "#ff6b6b", fontSize: 13 }}>{error}</div>
          ) : null}
        </div>

        {/* Main content */}
        <div className="ws-content">
          {tab === "tickets" ? (
            <div style={{ display: "grid", gap: 12 }}>
              <h2 style={{ margin: 0 }}>Заявки</h2>

              <div
                style={{
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 12,
                  padding: 12,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Создать заявку</div>

                <div className="grid-ticket-form">
                  <input
                    value={ticketForm.site}
                    onChange={(e) => setTicketForm((p) => ({ ...p, site: e.target.value }))}
                    placeholder="Site"
                  />
                  <input
                    type="date"
                    value={ticketForm.visit_date}
                    onChange={(e) => setTicketForm((p) => ({ ...p, visit_date: e.target.value }))}
                  />

                  <select
                    value={ticketForm.engineer_user_id}
                    onChange={(e) => setTicketForm((p) => ({ ...p, engineer_user_id: e.target.value }))}
                  >
                    <option value="">Assignee (optional)</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.first_name || u.last_name
                          ? `${u.first_name || ""} ${u.last_name || ""}`.trim()
                          : u.email}
                      </option>
                    ))}
                  </select>

                  <select
                    value={ticketForm.category_id}
                    onChange={(e) =>
                      setTicketForm((p) => ({ ...p, category_id: e.target.value, issue_id: "" }))
                    }
                  >
                    <option value="">Category (required)</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>

                  <select
                    value={ticketForm.issue_id}
                    onChange={(e) => setTicketForm((p) => ({ ...p, issue_id: e.target.value }))}
                  >
                    <option value="">Issue template (optional)</option>
                    {filteredIssuesForCategory.map((i) => (
                      <option key={i.id} value={i.id}>{i.title}</option>
                    ))}
                  </select>

                  <button onClick={createTicket}>Создать</button>
                </div>

                <textarea
                  style={{ marginTop: 10, width: "100%", minHeight: 110 }}
                  value={ticketForm.description}
                  onChange={(e) => setTicketForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Опиши проблему..."
                />
              </div>

              <div
                style={{
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 12,
                  padding: 12,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontWeight: 700 }}>Список</div>
                  <button onClick={refreshTickets}>Обновить</button>
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    onClick={() => setTicketFilter("open")}
                    style={{ fontWeight: 800, opacity: ticketFilter === "open" ? 1 : 0.55, border: "1px solid rgba(255,255,255,0.14)" }}
                  >
                    Open
                  </button>
                  <button
                    onClick={() => setTicketFilter("closed")}
                    style={{ fontWeight: 800, opacity: ticketFilter === "closed" ? 1 : 0.55, border: "1px solid rgba(255,255,255,0.14)" }}
                  >
                    Closed
                  </button>
                  <input
                    value={ticketSearch}
                    onChange={(e) => setTicketSearch(e.target.value)}
                    placeholder={ticketFilter === "open" ? "Поиск по открытым..." : "Поиск по закрытым..."}
                    style={{ flex: 1, minWidth: 120 }}
                  />
                </div>

                {visibleTickets.length === 0 ? (
                  <div style={{ opacity: 0.85, marginTop: 8 }}>Пока нет заявок.</div>
                ) : (
                  <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                    {visibleTickets.map((t) => (
                      <div
                        key={t.id}
                        onClick={() => setActiveTicket(t)}
                        style={{
                          cursor: "pointer",
                          border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: 10,
                          padding: 10,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                          <div style={{ fontWeight: 700 }}>{t.site}</div>
                          <div
                            style={{
                              fontWeight: 800,
                              color: (t.status || "open") === "open" ? "#3ee37a" : "#ff4d4d",
                              textTransform: "lowercase",
                            }}
                          >
                            {t.status || "open"}
                          </div>
                        </div>
                        <div style={{ opacity: 0.85 }}>
                          {t.category_name ? `Category: ${t.category_name}` : null}
                          {t.issue_title ? ` • Issue: ${t.issue_title}` : null}
                        </div>
                        <div style={{ marginTop: 6, opacity: 0.9 }}>
                          {(t.description || "").slice(0, 160)}
                          {(t.description || "").length > 160 ? "…" : ""}
                        </div>
                        {(t.status || "open") === "closed" ? (
                          <div style={{ marginTop: 10 }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                downloadTicketPdf(t);
                              }}
                            >
                              PDF
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {tab === "kb" ? (
            <div style={{ display: "grid", gap: 12 }}>
              <h2 style={{ margin: 0 }}>База проблем</h2>
              <div style={{ opacity: 0.85 }}>Категории и шаблоны решений</div>

              <div className="grid-2col">
                {/* categories */}
                <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Категории</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      placeholder="Новая категория (например: Lighting)"
                      style={{ flex: 1 }}
                    />
                    <button onClick={createCategory}>Добавить</button>
                  </div>
                  <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                    {categories.map((c) => (
                      <div
                        key={c.id}
                        style={{
                          border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: 10,
                          padding: 10,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <div>{c.name}</div>
                        <div style={{ opacity: 0.7, fontSize: 12 }}>{c.id}</div>
                      </div>
                    ))}
                    {categories.length === 0 ? (
                      <div style={{ opacity: 0.8 }}>Категорий пока нет.</div>
                    ) : null}
                  </div>
                </div>

                {/* issues */}
                <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Шаблоны проблем / решений</div>

                  <select
                    value={newIssue.category_id}
                    onChange={(e) => setNewIssue((p) => ({ ...p, category_id: e.target.value }))}
                    style={{ width: "100%", marginBottom: 8 }}
                  >
                    <option value="">Выбери категорию (required)</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>

                  <input
                    value={newIssue.title}
                    onChange={(e) => setNewIssue((p) => ({ ...p, title: e.target.value }))}
                    placeholder="Название (например: Dimmer не диммирует)"
                    style={{ width: "100%", marginBottom: 8 }}
                  />

                  <textarea
                    value={newIssue.description}
                    onChange={(e) => setNewIssue((p) => ({ ...p, description: e.target.value }))}
                    placeholder="Описание / симптомы"
                    style={{ width: "100%", minHeight: 70, marginBottom: 8 }}
                  />

                  <ChecklistBuilder
                    value={newIssue.steps}
                    onChange={(next) => setNewIssue((p) => ({ ...p, steps: next }))}
                  />

                  <textarea
                    value={newIssue.solution}
                    onChange={(e) => setNewIssue((p) => ({ ...p, solution: e.target.value }))}
                    placeholder="Решение"
                    style={{ width: "100%", minHeight: 70, marginBottom: 8 }}
                  />

                  <button onClick={createIssue} style={{ width: "100%" }}>
                    Добавить шаблон
                  </button>
                </div>
              </div>

              <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontWeight: 700 }}>Список шаблонов</div>
                  <button onClick={refreshAll}>Обновить</button>
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <select
                    value={issueCategoryFilter}
                    onChange={(e) => setIssueCategoryFilter(e.target.value)}
                    style={{ minWidth: 160 }}
                  >
                    <option value="">Все категории</option>
                    {categories.map((c) => (
                      <option key={c.id} value={String(c.id)}>{c.name}</option>
                    ))}
                  </select>
                  <input
                    value={issueSearch}
                    onChange={(e) => setIssueSearch(e.target.value)}
                    placeholder="Поиск по шаблонам..."
                    style={{ flex: 1, minWidth: 120 }}
                  />
                </div>

                {visibleIssues.length === 0 ? (
                  <div style={{ opacity: 0.85, marginTop: 8 }}>Пока нет шаблонов.</div>
                ) : (
                  <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                    {visibleIssues.map((i) => (
                      <div
                        key={i.id}
                        onClick={() => openIssue(i)}
                        style={{
                          cursor: "pointer",
                          border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: 10,
                          padding: 10,
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>{i.title}</div>
                        <div style={{ opacity: 0.85, fontSize: 13 }}>
                          {i.category_name ? `Category: ${i.category_name}` : `category_id: ${i.category_id}`}
                        </div>
                        {i.description ? (
                          <div style={{ marginTop: 6, opacity: 0.9 }}>
                            {(i.description || "").slice(0, 160)}
                            {(i.description || "").length > 160 ? "…" : ""}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {tab === "chat" ? (
            <div style={{ display: "grid", gap: 12 }}>
              <h2 style={{ margin: 0 }}>Чат</h2>

              <div className="grid-chat">
                <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontWeight: 700 }}>Пользователи</div>
                    <button onClick={refreshChatThreads}>Обновить</button>
                  </div>
                  <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                    {threads.map((t) => (
                      <button
                        key={t.other_user_id || t.user_id || t.id}
                        onClick={() => {
                          const id = t.other_user_id || t.user_id || t.id;
                          setSelectedUserId(id);
                          loadMessages(id);
                        }}
                        style={{
                          textAlign: "left",
                          padding: 10,
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.08)",
                          background:
                            selectedUserId === (t.other_user_id || t.user_id || t.id)
                              ? "rgba(255,255,255,0.06)"
                              : "transparent",
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>
                          {t.name || t.email || t.other_email || "User"}
                        </div>
                        <div style={{ opacity: 0.8, fontSize: 12 }}>
                          {t.email || t.other_email || ""}
                        </div>
                      </button>
                    ))}
                    {threads.length === 0 ? (
                      <div style={{ opacity: 0.8 }}>Пока нет диалогов.</div>
                    ) : null}
                  </div>
                </div>

                <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>
                    {selectedUserId ? "Сообщения" : "Выбери пользователя выше"}
                  </div>
                  <div style={{ minHeight: 260, display: "grid", gap: 6 }}>
                    {messages.map((m) => (
                      <div
                        key={m.id}
                        style={{
                          padding: 10,
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.08)",
                          maxWidth: "85%",
                          justifySelf: m.from_user_id === me?.user?.id ? "end" : "start",
                        }}
                      >
                        <div style={{ opacity: 0.85, fontSize: 12 }}>
                          {m.from_user_id === me?.user?.id ? "Вы" : "Он/Она"}
                        </div>
                        <div style={{ marginTop: 4 }}>{m.text}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                    <input
                      value={chatText}
                      onChange={(e) => setChatText(e.target.value)}
                      placeholder="Напиши сообщение…"
                      style={{ flex: 1 }}
                      disabled={!selectedUserId}
                    />
                    <button onClick={sendMessage} disabled={!selectedUserId || !chatText.trim()}>
                      Send
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Issue modal */}
      <Modal
        open={!!activeIssue}
        title={activeIssue ? `Шаблон: ${activeIssue.title}` : "Шаблон"}
        onClose={() => {
          setActiveIssue(null);
          setIsEditingIssue(false);
        }}
      >
        {activeIssue ? (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ opacity: 0.85, fontSize: 13 }}>
                {activeIssue.category_name
                  ? `Категория: ${activeIssue.category_name}`
                  : `category_id: ${activeIssue.category_id}`}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setIsEditingIssue((v) => !v)}>
                  {isEditingIssue ? "Отмена" : "Редактировать"}
                </button>
                <button onClick={deleteIssue}>Удалить</button>
              </div>
            </div>

            {isEditingIssue ? (
              <div style={{ display: "grid", gap: 10 }}>
                <select
                  value={editIssue.category_id}
                  onChange={(e) => setEditIssue((p) => ({ ...p, category_id: e.target.value }))}
                  style={{ width: "100%" }}
                >
                  <option value="">Выбери категорию (required)</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <input
                  value={editIssue.title}
                  onChange={(e) => setEditIssue((p) => ({ ...p, title: e.target.value }))}
                  placeholder="Название"
                />
                <textarea
                  value={editIssue.description}
                  onChange={(e) => setEditIssue((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Описание / симптомы"
                  style={{ width: "100%", minHeight: 90 }}
                />
                <ChecklistBuilder
                  value={editIssue.steps}
                  onChange={(next) => setEditIssue((p) => ({ ...p, steps: next }))}
                />
                <textarea
                  value={editIssue.solution}
                  onChange={(e) => setEditIssue((p) => ({ ...p, solution: e.target.value }))}
                  placeholder="Решение"
                  style={{ width: "100%", minHeight: 90 }}
                />
                <button onClick={saveIssueEdits}>Сохранить</button>
              </div>
            ) : (
              <>
                {activeIssue.description ? (
                  <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 10 }}>
                    <div style={{ fontWeight: 800, marginBottom: 8 }}>Описание / симптомы</div>
                    <div style={{ whiteSpace: "pre-wrap", opacity: 0.95 }}>{activeIssue.description}</div>
                  </div>
                ) : null}
                <ChecklistRunner stepsText={activeIssue.steps} />
                {activeIssue.solution ? (
                  <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 10 }}>
                    <div style={{ fontWeight: 800, marginBottom: 8 }}>Решение</div>
                    <div style={{ whiteSpace: "pre-wrap", opacity: 0.95 }}>{activeIssue.solution}</div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </Modal>

      <TicketModal
        open={!!activeTicket}
        ticket={activeTicket}
        onClose={() => setActiveTicket(null)}
        onUpdated={async () => {
          await refreshTickets();
          setActiveTicket((p) => (p ? { ...p, status: "closed" } : p));
        }}
        setError={setError}
        downloadPdf={() => activeTicket ? downloadTicketPdf(activeTicket) : null}
      />
    </div>
  );
}
