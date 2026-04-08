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
  leaderboard: () => request("GET", "/api/users/leaderboard"),
  adminList: () => request("GET", "/api/users/admin/list"),
  updateAvatar: (avatar_url) => request("PUT", "/api/users/me/avatar", { avatar_url }),
  customize: (payload) => request("POST", "/api/users/me/customize", payload),
  updatePermissions: (id, payload) => request("PUT", `/api/users/${id}/permissions`, payload),
  updateAdminProfile: (id, payload) => request("PUT", `/api/users/${id}/admin-profile`, payload),
  remove: (id) => request("DELETE", `/api/users/${id}`),
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
  listGlobalMessages: () => request("GET", "/api/chat/global"),
  listMessages: (otherUserId) => request("GET", `/api/chat/${otherUserId}`),
  sendGlobal: (text) => request("POST", "/api/chat/global", { text }),
  send: (otherUserId, text) =>
    request("POST", `/api/chat/${otherUserId}`, { text }),
  updateMessage: (messageId, text) => request("PUT", `/api/chat/messages/${messageId}`, { text }),
  removeMessage: (messageId) => request("DELETE", `/api/chat/messages/${messageId}`),
};

export const WikiAPI = {
  list: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.category) qs.set("category", params.category);
    if (params.search) qs.set("search", params.search);
    const q = qs.toString();
    return request("GET", `/api/wiki${q ? "?" + q : ""}`);
  },
  categories: () => request("GET", "/api/wiki/categories"),
  get: (id) => request("GET", `/api/wiki/${id}`),
  create: (payload) => request("POST", "/api/wiki", payload),
  update: (id, payload) => request("PUT", `/api/wiki/${id}`, payload),
  remove: (id) => request("DELETE", `/api/wiki/${id}`),
};
