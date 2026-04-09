function nowIso() {
  return new Date().toISOString();
}

function requireEnv(name, fallback = "") {
  const value = String(process.env[name] || fallback || "").trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function getZohoConfig() {
  return {
    accountsBase: String(process.env.ZOHO_ACCOUNTS_BASE || "https://accounts.zoho.com").replace(/\/+$/, ""),
    apiBase: String(process.env.ZOHO_PROJECTS_API_BASE || "https://projectsapi.zoho.com/restapi").replace(/\/+$/, ""),
    clientId: String(process.env.ZOHO_CLIENT_ID || "").trim(),
    clientSecret: String(process.env.ZOHO_CLIENT_SECRET || "").trim(),
    redirectUri: String(process.env.ZOHO_REDIRECT_URI || "").trim(),
    portalName: String(process.env.ZOHO_PORTAL_NAME || "").trim(),
    appBaseUrl: String(process.env.APP_BASE_URL || "").replace(/\/+$/, ""),
  };
}

export function buildZohoAuthUrl(userId) {
  const cfg = getZohoConfig();
  const state = Buffer.from(JSON.stringify({ userId, ts: Date.now() })).toString("base64url");
  const scopes = [
    "ZohoProjects.portals.READ",
    "ZohoProjects.projects.READ",
    "ZohoProjects.tasks.READ",
    "ZohoProjects.tasks.CREATE",
    "ZohoProjects.tasks.UPDATE",
    "ZohoProjects.timesheets.CREATE",
  ].join(",");

  const url = new URL(`${cfg.accountsBase}/oauth/v2/auth`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", requireEnv("ZOHO_CLIENT_ID", cfg.clientId));
  url.searchParams.set("redirect_uri", requireEnv("ZOHO_REDIRECT_URI", cfg.redirectUri));
  url.searchParams.set("scope", scopes);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

async function parseZohoResponse(res) {
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text;
  }

  if (!res.ok) {
    const message =
      data?.error ||
      data?.error_description ||
      data?.message ||
      (typeof data === "string" ? data : `Zoho HTTP ${res.status}`);
    throw new Error(message);
  }

  return data;
}

async function fetchZoho(url, options = {}) {
  const res = await fetch(url, options);
  return parseZohoResponse(res);
}

async function refreshAccessToken(user) {
  const cfg = getZohoConfig();
  const refreshToken = String(user?.zoho_refresh_token || "").trim();
  if (!refreshToken) throw new Error("Zoho account is not connected");

  const url = new URL(`${cfg.accountsBase}/oauth/v2/token`);
  url.searchParams.set("refresh_token", refreshToken);
  url.searchParams.set("client_id", requireEnv("ZOHO_CLIENT_ID", cfg.clientId));
  url.searchParams.set("client_secret", requireEnv("ZOHO_CLIENT_SECRET", cfg.clientSecret));
  url.searchParams.set("grant_type", "refresh_token");

  return fetchZoho(url.toString(), { method: "POST" });
}

export async function exchangeZohoCode(code) {
  const cfg = getZohoConfig();
  const url = new URL(`${cfg.accountsBase}/oauth/v2/token`);
  url.searchParams.set("code", code);
  url.searchParams.set("client_id", requireEnv("ZOHO_CLIENT_ID", cfg.clientId));
  url.searchParams.set("client_secret", requireEnv("ZOHO_CLIENT_SECRET", cfg.clientSecret));
  url.searchParams.set("redirect_uri", requireEnv("ZOHO_REDIRECT_URI", cfg.redirectUri));
  url.searchParams.set("grant_type", "authorization_code");
  return fetchZoho(url.toString(), { method: "POST" });
}

export async function getZohoAccessToken(db, user) {
  const accessToken = String(user?.zoho_access_token || "").trim();
  const expiresAt = user?.zoho_token_expires_at ? Date.parse(user.zoho_token_expires_at) : 0;

  if (accessToken && expiresAt && expiresAt > Date.now() + 60_000) {
    return accessToken;
  }

  const refreshed = await refreshAccessToken(user);
  const nextAccessToken = String(refreshed.access_token || "").trim();
  const expiresIn = Number(refreshed.expires_in || 3600);
  const nextExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  await db.query(
    `UPDATE users SET zoho_access_token=$1, zoho_token_expires_at=$2 WHERE id=$3`,
    [nextAccessToken, nextExpiresAt, user.id]
  );

  return nextAccessToken;
}

async function zohoApi(db, user, method, path, body, query = {}) {
  const cfg = getZohoConfig();
  const token = await getZohoAccessToken(db, user);
  const url = new URL(`${cfg.apiBase}${path}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return fetchZoho(url.toString(), {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function fetchZohoProjects(db, user) {
  const portalName = user?.zoho_portal_name || getZohoConfig().portalName;
  const data = await zohoApi(db, user, "GET", `/portal/${portalName}/projects/`);
  const projects = Array.isArray(data?.projects) ? data.projects : Array.isArray(data) ? data : [];
  return projects.map((project) => ({
    id: String(project.id_string || project.id || ""),
    name: project.name || project.project_name || "Unnamed project",
    status: project.status_name || project.status || "",
    owner_name: project.owner_name || project.owner?.name || "",
  }));
}

export async function fetchZohoTasks(db, user, projectId) {
  const portalName = user?.zoho_portal_name || getZohoConfig().portalName;
  const data = await zohoApi(db, user, "GET", `/portal/${portalName}/projects/${projectId}/tasks/`);
  const tasks = Array.isArray(data?.tasks) ? data.tasks : Array.isArray(data) ? data : [];
  return tasks.map((task) => ({
    id: String(task.id_string || task.id || ""),
    key: task.key || task.task_key || "",
    name: task.name || task.task_name || "Untitled task",
    status: task.status?.name || task.status_name || task.status || "",
    percent_complete: Number(task.percent_complete || task.completed_percent || 0) || 0,
  }));
}

export async function createZohoTask(db, user, projectId, payload) {
  const portalName = user?.zoho_portal_name || getZohoConfig().portalName;
  const body = {
    name: payload.name,
    description: payload.description || "",
  };

  const data = await zohoApi(db, user, "POST", `/portal/${portalName}/projects/${projectId}/tasks/`, body);
  const task = data?.tasks?.[0] || data?.task || data;
  return {
    id: String(task?.id_string || task?.id || ""),
    key: task?.key || task?.task_key || "",
    name: task?.name || payload.name,
  };
}

export async function completeZohoTask(db, user, projectId, taskId) {
  const portalName = user?.zoho_portal_name || getZohoConfig().portalName;
  const payloads = [
    { percent_complete: 100, status: "Closed" },
    { percent_complete: 100 },
  ];

  let lastError = null;
  for (const body of payloads) {
    try {
      return await zohoApi(db, user, "POST", `/portal/${portalName}/projects/${projectId}/tasks/${taskId}/`, body);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Failed to close Zoho task");
}

export async function createZohoTimeLog(db, user, projectId, taskId, secondsSpent, noteText = "") {
  const portalName = user?.zoho_portal_name || getZohoConfig().portalName;
  const hours = Math.max(0, Math.round((Number(secondsSpent) || 0) / 60) / 60);
  if (!hours) return null;

  const startedAt = new Date();
  const date = `${startedAt.getFullYear()}-${String(startedAt.getMonth() + 1).padStart(2, "0")}-${String(startedAt.getDate()).padStart(2, "0")}`;
  const payloadVariants = [
    { date, hours, notes: noteText },
    { date, hours, bill_status: "Non Billable", notes: noteText },
  ];

  let lastError = null;
  for (const body of payloadVariants) {
    try {
      return await zohoApi(db, user, "POST", `/portal/${portalName}/projects/${projectId}/tasks/${taskId}/logs/`, body);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Failed to write Zoho time log");
}

export async function fetchZohoCurrentUser(db, user) {
  const cfg = getZohoConfig();
  const token = await getZohoAccessToken(db, user);
  return fetchZoho(`${cfg.accountsBase}/oauth/user/info`, {
    method: "GET",
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
}

export function decodeZohoState(state) {
  try {
    const raw = Buffer.from(String(state || ""), "base64url").toString("utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getZohoFrontendRedirect(ok, message = "") {
  const cfg = getZohoConfig();
  const base = cfg.appBaseUrl || "";
  const suffix = ok ? "?zoho=connected" : `?zoho=error&message=${encodeURIComponent(message)}`;
  return base ? `${base}/${suffix.replace(/^\?/, "?")}` : `/${suffix.replace(/^\?/, "?")}`;
}

export async function storeZohoConnection(db, userId, tokenData, accountData) {
  const accountId = String(accountData?.ZUID || accountData?.id || "").trim();
  const email = String(accountData?.Email || accountData?.email || "").trim();
  const expiresIn = Number(tokenData?.expires_in || 3600);
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  const portalName = getZohoConfig().portalName;

  await db.query(
    `UPDATE users
     SET zoho_account_id=$1,
         zoho_account_email=$2,
         zoho_refresh_token=COALESCE($3, zoho_refresh_token),
         zoho_access_token=$4,
         zoho_token_expires_at=$5,
         zoho_portal_name=$6,
         zoho_connected_at=$7
     WHERE id=$8`,
    [
      accountId,
      email,
      String(tokenData?.refresh_token || "").trim() || null,
      String(tokenData?.access_token || "").trim(),
      expiresAt,
      portalName,
      nowIso(),
      userId,
    ]
  );
}

export async function clearZohoConnection(db, userId) {
  await db.query(
    `UPDATE users
     SET zoho_account_id=NULL,
         zoho_account_email=NULL,
         zoho_refresh_token=NULL,
         zoho_access_token=NULL,
         zoho_token_expires_at=NULL,
         zoho_portal_name=NULL,
         zoho_connected_at=NULL
     WHERE id=$1`,
    [userId]
  );
}
