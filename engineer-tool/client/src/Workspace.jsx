import React, { useEffect, useMemo, useState } from "react";
import {
  CategoriesAPI,
  IssuesAPI,
  TicketsAPI,
  UsersAPI,
  ChatAPI,
} from "./api.js";

function fmtISODateInput(value) {
  // value: Date or ISO string
  const d = value instanceof Date ? value : new Date(value);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function Workspace({ me, onLogout }) {
  const [tab, setTab] = useState("tickets"); // tickets | kb | chat

  // global
  const [error, setError] = useState("");

  // users
  const [users, setUsers] = useState([]);

  // categories/issues
  const [categories, setCategories] = useState([]);
  const [issues, setIssues] = useState([]);

  // tickets
  const [tickets, setTickets] = useState([]);
  const [ticketForm, setTicketForm] = useState({
    site: "Town House 5 / V",
    visit_date: fmtISODateInput(new Date()),
    engineer_user_id: "",
    category_id: "",
    issue_id: "",
    description: "",
  });

  // KB create forms
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newIssue, setNewIssue] = useState({
    category_id: "",
    title: "",
    description: "",
    steps: "",
    solution: "",
  });

  // chat (минимально)
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

  // -------- KB handlers --------
  async function createCategory() {
    setError("");
    const name = newCategoryName.trim();
    if (!name) {
      setError("Category name is required");
      return;
    }
    try {
      await CategoriesAPI.create(name);
      setNewCategoryName("");
      await refreshAll();
      setTab("kb");
    } catch (e) {
      setError(e?.message || "HTTP error");
    }
  }

  async function createIssue() {
    setError("");
    if (!newIssue.category_id) {
      setError("category_id is required");
      return;
    }
    if (!newIssue.title.trim()) {
      setError("Issue title is required");
      return;
    }
    try {
      await IssuesAPI.create({
        category_id: newIssue.category_id,
        title: newIssue.title.trim(),
        description: newIssue.description?.trim() || "",
        steps: newIssue.steps?.trim() || "",
        solution: newIssue.solution?.trim() || "",
      });
      setNewIssue({
        category_id: newIssue.category_id,
        title: "",
        description: "",
        steps: "",
        solution: "",
      });
      await refreshAll();
      setTab("kb");
    } catch (e) {
      setError(e?.message || "HTTP error");
    }
  }

  // -------- Tickets handlers --------
  async function createTicket() {
    setError("");
    // на твоём сервере category_id сейчас обязательный — поэтому заставляем выбрать
    if (!ticketForm.category_id) {
      setError("category_id is required");
      return;
    }
    if (!ticketForm.description.trim()) {
      setError("Описание проблемы обязательно");
      return;
    }

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
      setTab("tickets");
    } catch (e) {
      setError(e?.message || "HTTP error");
    }
  }

  // -------- Chat handlers --------
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

  const filteredIssuesForCategory = useMemo(() => {
    const cid = ticketForm.category_id || "";
    if (!cid) return issues;
    return issues.filter((x) => String(x.category_id) === String(cid));
  }, [issues, ticketForm.category_id]);

  return (
    <div style={{ padding: 16 }}>
      {/* top bar */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ minWidth: 260 }}>
          <div style={{ fontWeight: 700 }}>Engineer Tool</div>
          <div style={{ opacity: 0.85 }}>{meLabel}</div>

          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            <button onClick={() => setTab("tickets")}>Заявки</button>
            <button onClick={() => setTab("kb")}>Решения / База проблем</button>
            <button
              onClick={() => {
                setTab("chat");
                refreshChatThreads();
              }}
            >
              Чат
            </button>
            <button onClick={onLogout}>Выйти</button>
          </div>

          {error ? (
            <div style={{ marginTop: 10, color: "#ff6b6b" }}>{error}</div>
          ) : null}
        </div>

        {/* content */}
        <div style={{ flex: 1 }}>
          {tab === "tickets" ? (
            <div style={{ display: "grid", gap: 12 }}>
              <h2 style={{ margin: 0 }}>Заявки</h2>

              <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Создать заявку</div>

                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 220px" }}>
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
                        {(u.first_name || u.last_name) ? `${u.first_name || ""} ${u.last_name || ""}`.trim() : u.email}
                      </option>
                    ))}
                  </select>

                  <select
                    value={ticketForm.category_id}
                    onChange={(e) =>
                      setTicketForm((p) => ({
                        ...p,
                        category_id: e.target.value,
                        issue_id: "",
                      }))
                    }
                  >
                    <option value="">Category (required)</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>

                  <select
                    value={ticketForm.issue_id}
                    onChange={(e) => setTicketForm((p) => ({ ...p, issue_id: e.target.value }))}
                  >
                    <option value="">Issue template (optional)</option>
                    {filteredIssuesForCategory.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.title}
                      </option>
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

              <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontWeight: 700 }}>Список</div>
                  <button onClick={refreshTickets}>Обновить</button>
                </div>

                {tickets.length === 0 ? (
                  <div style={{ opacity: 0.85, marginTop: 8 }}>Пока нет заявок.</div>
                ) : (
                  <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                    {tickets.map((t) => (
                      <div
                        key={t.id}
                        style={{
                          border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: 10,
                          padding: 10,
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>
                          {t.site} • {t.status || "open"}
                        </div>
                        <div style={{ opacity: 0.85 }}>
                          {t.category_name ? `Category: ${t.category_name}` : null}
                          {t.issue_title ? ` • Issue: ${t.issue_title}` : null}
                        </div>
                        <div style={{ marginTop: 6, opacity: 0.9 }}>
                          {(t.description || "").slice(0, 160)}
                          {(t.description || "").length > 160 ? "…" : ""}
                        </div>
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

              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
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
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
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

                  <textarea
                    value={newIssue.steps}
                    onChange={(e) => setNewIssue((p) => ({ ...p, steps: e.target.value }))}
                    placeholder="Проверка по шагам (checklist)"
                    style={{ width: "100%", minHeight: 70, marginBottom: 8 }}
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

                {issues.length === 0 ? (
                  <div style={{ opacity: 0.85, marginTop: 8 }}>Пока нет шаблонов.</div>
                ) : (
                  <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                    {issues.map((i) => (
                      <div
                        key={i.id}
                        style={{
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

              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "320px 1fr" }}>
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
                          background: selectedUserId === (t.other_user_id || t.user_id || t.id) ? "rgba(255,255,255,0.06)" : "transparent",
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>{t.name || t.email || t.other_email || "User"}</div>
                        <div style={{ opacity: 0.8, fontSize: 12 }}>{t.email || t.other_email || ""}</div>
                      </button>
                    ))}
                    {threads.length === 0 ? <div style={{ opacity: 0.8 }}>Пока нет диалогов.</div> : null}
                  </div>
                </div>

                <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>
                    {selectedUserId ? "Сообщения" : "Выбери пользователя слева"}
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

        {/* right side panel placeholder */}
        <div style={{ minWidth: 320 }}>
          <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: 12 }}>
            <div style={{ fontWeight: 700 }}>Панель</div>
            <div style={{ opacity: 0.85, marginTop: 6 }}>Детали / Создание / Действия</div>
            <div style={{ marginTop: 10, opacity: 0.85 }}>
              Контекст выбранного элемента
              <div style={{ marginTop: 6, opacity: 0.75, fontSize: 13 }}>
                Если где-то видишь HTTP 500 — это сервер/SQLite. Если UI пустой — значит нет данных или не подключён CSS.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

