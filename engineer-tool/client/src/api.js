const API_BASE = (import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? "http://localhost:4000" : ""));

export function getToken() {
  return localStorage.getItem("token") || "";
}

export function setToken(token) {
  if (token) localStorage.setItem("token", token);
}

export function clearToken() {
  localStorage.removeItem("token");
}

function authHeader() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handle(res) {
  // если 401 — чистим токен, чтобы UI вернулся на логин
  if (res.status === 401) clearToken();

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const msg = data?.error ? data.error : `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data;
}

async function request(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...authHeader(),
    },
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  return handle(res);
}

export const AuthAPI = {
  login: (email, password) =>
    request("POST", "/api/auth/login", { email, password }),
  register: (payload) => request("POST", "/api/auth/register", payload),
};

export const UsersAPI = {
  me: () => request("GET", "/api/users/me"),
  list: () => request("GET", "/api/users"),
};

export const CategoriesAPI = {
  list: () => request("GET", "/api/categories"),
  create: (name) => request("POST", "/api/categories", { name }),
};

export const IssuesAPI = {
  list: () => request("GET", "/api/issues"),
  create: (payload) => request("POST", "/api/issues", payload),
  update: (id, payload) => request("PUT", `/api/issues/${id}`, payload),
  remove: (id) => request("DELETE", `/api/issues/${id}`),
};

export const TicketsAPI = {
  list: () => request("GET", "/api/tickets"),
  create: (payload) => request("POST", "/api/tickets", payload),
  steps: (id) => request("GET", `/api/tickets/${id}/steps`),
  bootstrapSteps: (id, steps) => request("POST", `/api/tickets/${id}/bootstrap-steps`, { steps }),
  updateStep: (ticketId, stepId, result) =>
    request("PUT", `/api/tickets/${ticketId}/steps/${stepId}`, { result }),
  notes: (id) => request("GET", `/api/tickets/${id}/notes`),
  addNote: (id, note_text) => request("POST", `/api/tickets/${id}/notes`, { note_text }),
  setStatus: (id, status) => request("PUT", `/api/tickets/${id}/status`, { status }),
  // Download report (authenticated) as Blob
  downloadReport: async (id) => {
    const res = await fetch(`${API_BASE}/api/tickets/${id}/report.pdf`, {
      method: "GET",
      headers: { ...authHeader() },
      credentials: "include",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
    return res.blob();
  },
};

export const ChatAPI = {
  listThreads: () => request("GET", "/api/chat/threads"),
  listMessages: (otherUserId) => request("GET", `/api/chat/${otherUserId}`),
  send: (otherUserId, text) =>
    request("POST", `/api/chat/${otherUserId}`, { text }),
};

