// server/src/bot/index.js вЂ” Zoho Task Bot
import TelegramBot from "node-telegram-bot-api";
import cron from "node-cron";
import { getDb } from "../db.js";
import {
  fetchZohoProjects,
  fetchZohoTasks,
  fetchZohoProjectUsers,
  fetchZohoProjectFolders,
  fetchZohoProjectDocuments,
  fetchZohoTaskAttachments,
  downloadZohoFile,
  createZohoTask,
  completeZohoTask,
  createZohoTimeLog,
  buildZohoAuthUrlForBot,
} from "../utils/zoho.js";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

let bot = null;

// In-memory session: chatId -> { state, data }
const sessions = new Map();

// в”Ђв”Ђ Р“Р»Р°РІРЅРѕРµ РјРµРЅСЋ (РїРѕСЃС‚РѕСЏРЅРЅР°СЏ РєР»Р°РІРёР°С‚СѓСЂР°) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
const MAIN_MENU = {
  reply_markup: {
    keyboard: [
      [{ text: "Создать задачу" }, { text: "Проекты" }],
      [{ text: "Мой профиль" }, { text: "Подключить Zoho" }],
      [{ text: "Статистика" }, { text: "Помощь" }],
    ],
    resize_keyboard: true,
    persistent: true,
  },
  parse_mode: "HTML",
};

// в”Ђв”Ђ helpers в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

// РЈРґР°Р»СЏРµС‚ РїСЂРµРґС‹РґСѓС‰РµРµ СЃРѕРѕР±С‰РµРЅРёРµ Р±РѕС‚Р° РёР· СЃРµСЃСЃРёРё Рё РѕС‚РїСЂР°РІР»СЏРµС‚ РЅРѕРІРѕРµ
async function cleanSend(chatId, text, options = {}) {
  const session = sessions.get(chatId) || {};
  if (session._lastMsgId) {
    try { await bot.deleteMessage(chatId, session._lastMsgId); } catch (_) {}
  }
  const sent = await bot.sendMessage(chatId, text, options);
  sessions.set(chatId, { ...sessions.get(chatId), _lastMsgId: sent.message_id });
  return sent;
}

function uid() {
  return `tg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function fmt(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getElapsed(task) {
  let total = Number(task.elapsed_seconds) || 0;
  if (task.timer_started_at && task.status === "running") {
    total += Math.floor((Date.now() - new Date(task.timer_started_at).getTime()) / 1000);
  }
  return total;
}

function taskCard(task, elapsed) {
  const status =
    task.status === "running"
      ? "Running"
      : task.status === "paused"
        ? "Paused"
        : task.status === "done"
          ? "Closed"
          : "Pending";
  return (
    `<b>${task.zoho_task_name}</b>\n` +
    `Project: ${task.zoho_project_name}\n` +
    `Status: ${status}\n` +
    `Time: <b>${fmt(elapsed)}</b>`
  );
}

function taskKeyboard(taskId, status) {
  if (status === "done") return { inline_keyboard: [] };
  if (status === "running") {
    return {
      inline_keyboard: [[
        { text: "Пауза", callback_data: `pause_${taskId}` },
        { text: "Закрыть задачу", callback_data: `close_${taskId}` },
      ]],
    };
  }
  return {
    inline_keyboard: [[
      { text: "Старт", callback_data: `start_${taskId}` },
      { text: "Закрыть задачу", callback_data: `close_${taskId}` },
    ]],
  };
}

function matchesAny(text, variants) {
  return variants.some((variant) => text === variant || text.includes(variant));
}

// в”Ђв”Ђ DB helpers в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
function taskKeyboardWithFiles(taskId, status) {
  if (status === "done") return { inline_keyboard: [] };
  if (status === "running") {
    return {
      inline_keyboard: [[
        { text: "Pause", callback_data: `pause_${taskId}` },
        { text: "Close task", callback_data: `close_${taskId}` },
      ], [
        { text: "Project files", callback_data: `files_${taskId}` },
      ]],
    };
  }
  return {
    inline_keyboard: [[
      { text: "Start", callback_data: `start_${taskId}` },
      { text: "Close task", callback_data: `close_${taskId}` },
    ], [
      { text: "Project files", callback_data: `files_${taskId}` },
    ]],
  };
}

function safeFileName(name) {
  return String(name || "zoho-file")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim() || "zoho-file";
}

function getChatSession(chatId) {
  return sessions.get(chatId) || {};
}

function setChatSession(chatId, patch) {
  sessions.set(chatId, { ...getChatSession(chatId), ...patch });
}

function buildFolderKeyboard(taskId, folders, files, folderId = "") {
  const rows = [];
  const scope = folderId || "root";
  if (folderId) {
    rows.push([{ text: "Back to root", callback_data: `files_${taskId}` }]);
  }
  folders.forEach((folder) => {
    rows.push([{ text: `[Folder] ${folder.name}`, callback_data: `folder:${taskId}:${folder.id}` }]);
  });
  files.forEach((file, idx) => {
    rows.push([{ text: `${file.source === "task" ? "[Task]" : "[Project]"} ${file.name}`, callback_data: `file:${taskId}:${scope}:${idx}` }]);
  });
  return { inline_keyboard: rows };
}

async function getZohoUser(db) {
  // РџСЂРёРѕСЂРёС‚РµС‚: admin СЃ С‚РѕРєРµРЅРѕРј
  const adminQ = await db.query(
    `SELECT * FROM users WHERE zoho_refresh_token IS NOT NULL AND role='admin' ORDER BY created_at LIMIT 1`
  );
  if (adminQ.rows?.[0]) return adminQ.rows[0];
  // Fallback: Р»СЋР±РѕР№ СЃ С‚РѕРєРµРЅРѕРј
  const anyQ = await db.query(
    `SELECT * FROM users WHERE zoho_refresh_token IS NOT NULL ORDER BY created_at LIMIT 1`
  );
  return anyQ.rows?.[0] || null;
}

// Р’РѕР·РІСЂР°С‰Р°РµС‚ Zoho-Р°РєРєР°СѓРЅС‚ СЃР°РјРѕРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ.
// РџСЂРёРѕСЂРёС‚РµС‚: СЃРѕР±СЃС‚РІРµРЅРЅС‹Р№ С‚РѕРєРµРЅ РІ tg_users в†’ users РїРѕ email в†’ admin fallback
async function getZohoUserForChat(db, chatId) {
  const tgUser = await getTgUser(db, chatId);
  // 1. РЎРѕР±СЃС‚РІРµРЅРЅС‹Р№ Zoho-С‚РѕРєРµРЅ РїРѕРґРєР»СЋС‡С‘РЅ РїСЂСЏРјРѕ РІ Р±РѕС‚Рµ
  if (tgUser?.zoho_refresh_token) return tgUser;
  // 2. РђРєРєР°СѓРЅС‚ РІ РІРµР±-РїСЂРёР»РѕР¶РµРЅРёРё СЃ С‚РµРј Р¶Рµ email
  if (tgUser?.email) {
    const q = await db.query(
      `SELECT * FROM users WHERE LOWER(email)=LOWER($1) AND zoho_refresh_token IS NOT NULL LIMIT 1`,
      [tgUser.email]
    );
    if (q.rows?.[0]) return q.rows[0];
  }
  return getZohoUser(db);
}

async function getTgUser(db, chatId) {
  const q = await db.query(`SELECT * FROM tg_users WHERE chat_id=$1`, [String(chatId)]);
  return q.rows?.[0] || null;
}

async function saveTgUser(db, chatId, name, email) {
  await db.query(
    `INSERT INTO tg_users (chat_id, name, email, created_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (chat_id) DO UPDATE SET name=$2, email=$3`,
    [String(chatId), name, email, new Date().toISOString()]
  );
}

async function getTgTask(db, id) {
  const q = await db.query(`SELECT * FROM tg_tasks WHERE id=$1`, [id]);
  return q.rows?.[0] || null;
}

async function updateTaskMessage(db, task) {
  if (!task.tg_message_id) return;
  const elapsed = getElapsed(task);
  try {
    await bot.editMessageText(taskCard(task, elapsed), {
      chat_id: task.assignee_chat_id,
      message_id: Number(task.tg_message_id),
      parse_mode: "HTML",
      reply_markup: taskKeyboardWithFiles(task.id, task.status),
    });
  } catch (_) {}
}

// в”Ђв”Ђ Send task to assignee в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
async function sendTaskToAssignee(db, assigneeChatId, taskRow) {
  const elapsed = getElapsed(taskRow);
  const msg = await bot.sendMessage(assigneeChatId, taskCard(taskRow, elapsed), {
    parse_mode: "HTML",
    reply_markup: taskKeyboardWithFiles(taskRow.id, taskRow.status),
  });
  await db.query(`UPDATE tg_tasks SET tg_message_id=$1 WHERE id=$2`, [
    String(msg.message_id), taskRow.id,
  ]);
}

// в”Ђв”Ђ /start в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
async function showTaskFiles(chatId, taskId) {
  const db = getDb();
  const task = await getTgTask(db, taskId);
  if (!task) {
    await cleanSend(chatId, "Task not found.");
    return;
  }

  const zohoUser = await getZohoUserForChat(db, chatId);
  if (!zohoUser) {
    await cleanSend(chatId, "Zoho не подключён. Сначала подключите Zoho в боте.");
    return;
  }

  await cleanSend(chatId, "Loading project files and task attachments...");

  const [projectFilesResult, taskFilesResult, foldersResult] = await Promise.allSettled([
    fetchZohoProjectDocuments(db, zohoUser, task.zoho_project_id),
    fetchZohoTaskAttachments(db, zohoUser, task.zoho_project_id, task.zoho_task_id),
    fetchZohoProjectFolders(db, zohoUser, task.zoho_project_id),
  ]);

  const projectFiles = projectFilesResult.status === "fulfilled" ? projectFilesResult.value : [];
  const taskFiles = taskFilesResult.status === "fulfilled" ? taskFilesResult.value : [];
  const folders = foldersResult.status === "fulfilled" ? foldersResult.value : [];
  const files = [...taskFiles, ...projectFiles]
    .filter((file) => file.download_url)
    .sort((a, b) => String(b.uploaded_at || "").localeCompare(String(a.uploaded_at || "")))
    .slice(0, 20);
  const rootFolders = folders.filter((folder) => !folder.parent_id || folder.parent_id === "crmworkspace");
  const rootFiles = projectFiles
    .filter((file) => file.download_url)
    .sort((a, b) => String(b.uploaded_at || "").localeCompare(String(a.uploaded_at || "")))
    .slice(0, 20);

  if (!files.length && !rootFolders.length) {
    const projectErr = projectFilesResult.status === "rejected" ? projectFilesResult.reason?.message : "";
    const taskErr = taskFilesResult.status === "rejected" ? taskFilesResult.reason?.message : "";
    const folderErr = foldersResult.status === "rejected" ? foldersResult.reason?.message : "";
    const hint = projectErr || taskErr || folderErr
      ? "\n\nЕсли файлы не отображаются, переподключите Zoho в боте, чтобы обновить доступ."
      : "";
    await cleanSend(chatId, `No downloadable Zoho files were found for this task.${hint}`);
    return;
  }

  const session = getChatSession(chatId);
  const rootCombinedFiles = [...taskFiles, ...rootFiles].slice(0, 20);
  const fileMaps = { ...(session.fileMaps || {}), [taskId]: files, [`${taskId}:root`]: rootCombinedFiles };
  const folderMaps = { ...(session.folderMaps || {}), [taskId]: folders };
  setChatSession(chatId, { fileMaps, folderMaps });

  const keyboard = buildFolderKeyboard(taskId, rootFolders, rootCombinedFiles);

  await cleanSend(
    chatId,
    `Task: ${task.zoho_task_name}\nProject: ${task.zoho_project_name}\n\nChoose a folder or file:`,
    { reply_markup: keyboard }
  );
}

async function showTaskFolder(chatId, taskId, folderId) {
  const db = getDb();
  const task = await getTgTask(db, taskId);
  if (!task) {
    await cleanSend(chatId, "Task not found.");
    return;
  }

  const zohoUser = await getZohoUserForChat(db, chatId);
  if (!zohoUser) {
    await cleanSend(chatId, "Zoho не подключён. Сначала подключите Zoho в боте.");
    return;
  }

  const session = getChatSession(chatId);
  const folderMaps = session.folderMaps || {};
  const allFolders = folderMaps[taskId] || await fetchZohoProjectFolders(db, zohoUser, task.zoho_project_id);
  const currentFolder = allFolders.find((folder) => folder.id === folderId);
  const childFolders = allFolders.filter((folder) => folder.parent_id === folderId);
  const files = await fetchZohoProjectDocuments(db, zohoUser, task.zoho_project_id, folderId);
  const storedFiles = {
    ...(session.fileMaps || {}),
    [taskId]: session.fileMaps?.[taskId] || [],
    [`${taskId}:${folderId}`]: files.filter((file) => file.download_url).slice(0, 20),
  };
  setChatSession(chatId, { folderMaps: { ...folderMaps, [taskId]: allFolders }, fileMaps: storedFiles });

  await cleanSend(
    chatId,
    `Folder: ${currentFolder?.name || folderId}\nProject: ${task.zoho_project_name}\n\nChoose a subfolder or file:`,
    { reply_markup: buildFolderKeyboard(taskId, childFolders, storedFiles[`${taskId}:${folderId}`], folderId) }
  );
}

async function sendTaskFile(chatId, taskId, fileIndex) {
  const db = getDb();
  const session = getChatSession(chatId);
  const files = session.fileMaps?.[taskId] || [];
  const file = files[fileIndex];
  if (!file) {
    await cleanSend(chatId, "The file list is outdated. Open project files again.");
    return;
  }

  const zohoUser = await getZohoUserForChat(db, chatId);
  if (!zohoUser) {
    await cleanSend(chatId, "Zoho не подключён. Сначала подключите Zoho в боте.");
    return;
  }

  await bot.sendMessage(chatId, `Downloading file: ${file.name}`);

  try {
    const downloaded = await downloadZohoFile(db, zohoUser, file.download_url);
    await bot.sendDocument(
      chatId,
      downloaded.bytes,
      {
        caption: `${file.name}\nSource: ${file.source === "task" ? "task attachment" : "project file"}`,
      },
      {
        filename: safeFileName(file.name),
        contentType: downloaded.contentType || file.content_type || "application/octet-stream",
      }
    );
  } catch (e) {
    await bot.sendMessage(
      chatId,
      `Не удалось отправить файл.\n\n${e.message}\n\nЕсли подключение устарело, переподключите Zoho в боте.`
    );
  }
}

async function sendScopedTaskFile(chatId, taskId, scope, fileIndex) {
  const db = getDb();
  const session = getChatSession(chatId);
  const key = scope === "root" ? `${taskId}:root` : `${taskId}:${scope}`;
  const files = session.fileMaps?.[key] || [];
  const file = files[fileIndex];
  if (!file) {
    await cleanSend(chatId, "The file list is outdated. Open the folder again.");
    return;
  }

  const zohoUser = await getZohoUserForChat(db, chatId);
  if (!zohoUser) {
    await cleanSend(chatId, "Zoho не подключён. Сначала подключите Zoho в боте.");
    return;
  }

  await bot.sendMessage(chatId, `Downloading file: ${file.name}`);

  try {
    const downloaded = await downloadZohoFile(db, zohoUser, file.download_url);
    await bot.sendDocument(
      chatId,
      downloaded.bytes,
      {
        caption: `${file.name}\nSource: ${file.source === "task" ? "task attachment" : "project file"}`,
      },
      {
        filename: safeFileName(file.name),
        contentType: downloaded.contentType || file.content_type || "application/octet-stream",
      }
    );
  } catch (e) {
    await bot.sendMessage(
      chatId,
      `Не удалось отправить файл.\n\n${e.message}\n\nЕсли подключение устарело, переподключите Zoho в боте.`
    );
  }
}

async function handleStart(msg) {
  const chatId = msg.chat.id;
  const db = getDb();
  const existing = await getTgUser(db, chatId);
  if (existing) {
    return bot.sendMessage(chatId,
      `С возвращением, <b>${existing.name}</b>!\n\nВыберите действие:`,
      MAIN_MENU
    );
  }
  const name = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") || "User";
  sessions.set(chatId, { state: "await_email", name });
  bot.sendMessage(chatId,
    `Привет, <b>${name}</b>!\n\nВведите свой email, который используется в Zoho, чтобы я мог назначать вам задачи:`,
    { parse_mode: "HTML" }
  );
}

// в”Ђв”Ђ РџСЂРѕС„РёР»СЊ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
async function handleProfile(chatId) {
  const db = getDb();
  const user = await getTgUser(db, chatId);
  if (!user) return bot.sendMessage(chatId, "Вы ещё не зарегистрированы. Нажмите /start");
  bot.sendMessage(chatId,
    `<b>Профиль</b>\n\n` +
    `Имя: ${user.name}\n` +
    `Email: ${user.email}\n\n` +
    `Чтобы изменить email, просто отправьте новый email сюда.`,
    { parse_mode: "HTML" }
  );
}

// в”Ђв”Ђ РџРѕРґРєР»СЋС‡РёС‚СЊ Zoho в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
async function handleConnectZoho(chatId) {
  const db = getDb();
  const tgUser = await getTgUser(db, chatId);
  if (!tgUser) {
    return bot.sendMessage(chatId, "Сначала зарегистрируйтесь через /start");
  }
  try {
    const url = buildZohoAuthUrlForBot(chatId);
    const isConnected = Boolean(tgUser.zoho_refresh_token);
    bot.sendMessage(chatId,
      (isConnected
        ? `Zoho уже подключён.\n\nЕсли хотите переподключить аккаунт, используйте ссылку ниже.`
        : `<b>Подключите свой Zoho-аккаунт</b>\n\nПосле этого задачи будут создаваться и закрываться от вашего имени.`) +
      `\n\n<a href="${url}">Открыть авторизацию Zoho</a>`,
      { parse_mode: "HTML", disable_web_page_preview: true }
    );
  } catch (e) {
    bot.sendMessage(chatId, `Ошибка: ${e.message}`);
  }
}

// в”Ђв”Ђ РЎС‚Р°С‚РёСЃС‚РёРєР° в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
async function handleStats(chatId) {
  const db = getDb();
  const user = await getTgUser(db, chatId);
  if (!user) return bot.sendMessage(chatId, "Сначала зарегистрируйтесь через /start");

  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const q = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE created_at >= $2) AS week_tasks,
      COALESCE(SUM(elapsed_seconds) FILTER (WHERE created_at >= $2), 0) AS week_seconds,
      COUNT(*) FILTER (WHERE created_at >= $3) AS month_tasks,
      COALESCE(SUM(elapsed_seconds) FILTER (WHERE created_at >= $3), 0) AS month_seconds,
      COUNT(*) AS all_tasks,
      COALESCE(SUM(elapsed_seconds), 0) AS all_seconds
    FROM tg_tasks
    WHERE assignee_chat_id=$1 AND status='done'
  `, [String(chatId), monday.toISOString(), monthStart.toISOString()]);

  const s = q.rows[0];
  bot.sendMessage(chatId,
    `<b>Ваша статистика</b>\n\n` +
    `<b>Эта неделя:</b>\n` +
    `- Закрыто задач: ${s.week_tasks}\n` +
    `- Залогировано времени: ${fmt(Number(s.week_seconds))}\n\n` +
    `<b>Этот месяц:</b>\n` +
    `- Закрыто задач: ${s.month_tasks}\n` +
    `- Залогировано времени: ${fmt(Number(s.month_seconds))}\n\n` +
    `<b>За всё время:</b>\n` +
    `- Закрыто задач: ${s.all_tasks}\n` +
    `- Залогировано времени: ${fmt(Number(s.all_seconds))}`,
    { parse_mode: "HTML" }
  );
}

// в”Ђв”Ђ РџРѕРјРѕС‰СЊ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
function handleHelp(chatId) {
  bot.sendMessage(chatId,
    `<b>Как пользоваться ботом</b>\n\n` +
    `<b>Создать задачу</b> — выберите проект, введите название задачи и назначьте исполнителя. Задача будет создана в Zoho и отправлена исполнителю.\n\n` +
    `<b>Проекты</b> — просмотр задач по проектам. Нажмите на задачу, чтобы взять её себе.\n\n` +
    `<b>Старт / Пауза</b> — управление таймером прямо из сообщения задачи.\n\n` +
    `<b>Закрыть задачу</b> — время уйдёт в Zoho, а задача будет закрыта.`,
    { parse_mode: "HTML" }
  );
}

// в”Ђв”Ђ /projects в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
async function handleProjects(chatId) {
  const db = getDb();
  const zohoUser = await getZohoUser(db);
  if (!zohoUser) return cleanSend(chatId, "Zoho не подключён.");
  await cleanSend(chatId, "Загружаю проекты...");
  try {
    const projects = await fetchZohoProjects(db, zohoUser);
    if (!projects.length) return cleanSend(chatId, "Проекты не найдены.");
    sessions.set(chatId, { ...sessions.get(chatId), state: "search_project", projects, mode: "view" });
    await cleanSend(chatId,
      `Найдено проектов: <b>${projects.length}</b>\n\nВведите название проекта или его часть для поиска:`,
      { parse_mode: "HTML" }
    );
  } catch (e) {
    cleanSend(chatId, `Ошибка: ${e.message}`);
  }
}

// в”Ђв”Ђ РџРѕРєР°Р·Р°С‚СЊ РѕС‚С„РёР»СЊС‚СЂРѕРІР°РЅРЅС‹Рµ РїСЂРѕРµРєС‚С‹ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
async function showFilteredProjects(chatId, projects, query, mode) {
  const filtered = query
    ? projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    : projects;

  if (!filtered.length) {
    return cleanSend(chatId,
      `Проект "<b>${query}</b>" не найден.\nПопробуйте другое название:`,
      { parse_mode: "HTML" }
    );
  }

  const prefix = mode === "newtask" ? "newtask_proj_" : "proj_";
  const keyboard = {
    inline_keyboard: [
      ...filtered.slice(0, 20).map((p) => ([
        { text: `${p.name}`, callback_data: `${prefix}${p.id}` },
      ])),
      [{ text: "Искать снова", callback_data: `search_again_${mode}` }],
    ],
  };
  await cleanSend(chatId,
    filtered.length === projects.length
      ? `Все проекты (${filtered.length}):`
      : `Найдено <b>${filtered.length}</b> из ${projects.length}:`,
    { parse_mode: "HTML", reply_markup: keyboard }
  );
}

// в”Ђв”Ђ /newtask в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
async function handleNewTask(chatId) {
  const db = getDb();
  const zohoUser = await getZohoUser(db);
  if (!zohoUser) return bot.sendMessage(chatId, "Zoho не подключён.");
  await cleanSend(chatId, "Загружаю проекты...");
  try {
    const projects = await fetchZohoProjects(db, zohoUser);
    if (!projects.length) return cleanSend(chatId, "Проекты не найдены.");
    sessions.set(chatId, { state: "search_project", projects, mode: "newtask" });
    await cleanSend(chatId,
      `Найдено проектов: <b>${projects.length}</b>\n\nВведите название проекта или его часть для поиска:`,
      { parse_mode: "HTML" }
    );
  } catch (e) {
    cleanSend(chatId, `Ошибка: ${e.message}`);
  }
}

// в”Ђв”Ђ callback_query handler в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
async function handleCallback(query) {
  const chatId = query.message.chat.id;
  const data = query.data;
  const db = getDb();

  await bot.answerCallbackQuery(query.id);

  if (data.startsWith("files_")) {
    const taskId = data.slice(6);
    await showTaskFiles(chatId, taskId);
    return;
  }

  if (data.startsWith("file:")) {
    const [, taskId, scope, fileIndexRaw] = data.split(":");
    const fileIndex = Number(fileIndexRaw);
    if (!taskId || Number.isNaN(fileIndex)) return;
    await sendScopedTaskFile(chatId, taskId, scope || "root", fileIndex);
    return;
  }

  if (data.startsWith("folder:")) {
    const [, taskId, folderId] = data.split(":");
    if (!taskId || !folderId) return;
    await showTaskFolder(chatId, taskId, folderId);
    return;
  }

  // в”Ђв”Ђ Р’С‹Р±РѕСЂ РїСЂРѕРµРєС‚Р° (РїСЂРѕСЃРјРѕС‚СЂ Р·Р°РґР°С‡) в”Ђв”Ђ
  if (data.startsWith("proj_")) {
    const projectId = data.slice(5);
    const zohoUser = await getZohoUser(db);
    await cleanSend(chatId, "Загружаю задачи...");
    try {
      const tasks = await fetchZohoTasks(db, zohoUser, projectId);
      const projects = await fetchZohoProjects(db, zohoUser);
      const project = projects.find((p) => p.id === projectId);
      if (!tasks.length) return cleanSend(chatId, "В этом проекте задач нет.");
      const keyboard = {
        inline_keyboard: tasks.map((t, idx) => ([
          { text: `${t.name}`, callback_data: `task_${projectId}_idx${idx}` },
        ])),
      };
      sessions.set(chatId, { state: "task_list", projectId, project, tasks });
      await cleanSend(chatId, `<b>${project?.name}</b>\nВыберите задачу:`, {
        parse_mode: "HTML", reply_markup: keyboard,
      });
    } catch (e) {
      cleanSend(chatId, `Ошибка: ${e.message}`);
    }
    return;
  }

  // в”Ђв”Ђ Р’С‹Р±РѕСЂ Р·Р°РґР°С‡Рё в†’ РЅР°Р·РЅР°С‡РёС‚СЊ РЅР° СЃРµР±СЏ в”Ђв”Ђ
  if (data.startsWith("task_")) {
    const parts = data.split("_");
    const projectId = parts[1];
    const idx = parseInt(parts[2].replace("idx", ""), 10);
    const session = sessions.get(chatId) || {};
    const task = session.tasks?.[idx];
    const project = session.project;

    if (!task) return;

    const taskRow = {
      id: uid(),
      zoho_project_id: projectId,
      zoho_project_name: project?.name || "",
      zoho_task_id: task.id,
      zoho_task_name: task?.name || "Task",
      assignee_chat_id: String(chatId),
      creator_chat_id: String(chatId),
      elapsed_seconds: 0,
      status: "pending",
      created_at: new Date().toISOString(),
    };

    await db.query(
      `INSERT INTO tg_tasks (id,zoho_project_id,zoho_project_name,zoho_task_id,zoho_task_name,assignee_chat_id,creator_chat_id,elapsed_seconds,status,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [taskRow.id, taskRow.zoho_project_id, taskRow.zoho_project_name, taskRow.zoho_task_id,
       taskRow.zoho_task_name, taskRow.assignee_chat_id, taskRow.creator_chat_id,
       0, "pending", taskRow.created_at]
    );
    await sendTaskToAssignee(db, chatId, taskRow);
    return;
  }

  // в”Ђв”Ђ в–¶пёЏ РЎС‚Р°СЂС‚ С‚Р°Р№РјРµСЂР° в”Ђв”Ђ
  if (data.startsWith("start_")) {
    const taskId = data.slice(6);
    const task = await getTgTask(db, taskId);
    if (!task || task.status === "done") return;
    const now = new Date().toISOString();
    await db.query(
      `UPDATE tg_tasks SET status='running', timer_started_at=$1 WHERE id=$2`,
      [now, taskId]
    );
    const updated = await getTgTask(db, taskId);
    await updateTaskMessage(db, updated);
    return;
  }

  // в”Ђв”Ђ вЏё РџР°СѓР·Р° в”Ђв”Ђ
  if (data.startsWith("pause_")) {
    const taskId = data.slice(6);
    const task = await getTgTask(db, taskId);
    if (!task || task.status !== "running") return;
    const elapsed = getElapsed(task);
    await db.query(
      `UPDATE tg_tasks SET status='paused', timer_started_at=NULL, elapsed_seconds=$1 WHERE id=$2`,
      [elapsed, taskId]
    );
    const updated = await getTgTask(db, taskId);
    await updateTaskMessage(db, updated);
    return;
  }

  // в”Ђв”Ђ вњ… Р—Р°РєСЂС‹С‚СЊ в”Ђв”Ђ
  if (data.startsWith("close_")) {
    const taskId = data.slice(6);
    const task = await getTgTask(db, taskId);
    if (!task || task.status === "done") return;

    const elapsed = getElapsed(task);
    await db.query(
      `UPDATE tg_tasks SET status='done', timer_started_at=NULL, elapsed_seconds=$1 WHERE id=$2`,
      [elapsed, taskId]
    );

    bot.sendMessage(chatId, `Закрываю задачу в Zoho и логирую <b>${fmt(elapsed)}</b>...`, { parse_mode: "HTML" });

    try {
      const db2 = getDb();
      const zohoUser = await getZohoUserForChat(db2, chatId);

      // Р›РѕРіРёСЂСѓРµРј РІСЂРµРјСЏ РѕС‚ РёРјРµРЅРё РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
      let timeLogged = false;
      let timeErrMsg = "";
      const tgUserForLog = await getTgUser(db2, chatId);
      const ownerId = String(tgUserForLog?.zoho_user_id || zohoUser?.zoho_account_id || "").trim();
      if (elapsed > 60) {
        try {
          await createZohoTimeLog(
            db2, zohoUser,
            task.zoho_project_id, task.zoho_task_id,
            elapsed,
            `Работа над задачей (Telegram bot)`,
            ownerId
          );
          timeLogged = true;
        } catch (timeErr) {
          timeErrMsg = timeErr.message;
          console.error("[Bot] Time log error:", timeErr.message);
        }
      }

      // Р—Р°РєСЂС‹РІР°РµРј Р·Р°РґР°С‡Сѓ вЂ” РѕС‚РґРµР»СЊРЅРѕ, РІСЃРµРіРґР°
      let taskClosed = false;
      let closeErrMsg = "";
      try {
        await completeZohoTask(db2, zohoUser, task.zoho_project_id, task.zoho_task_id);
        taskClosed = true;
      } catch (closeErr) {
        closeErrMsg = closeErr.message;
        console.error("[Bot] Close task error:", closeErr.message);
      }

      if (taskClosed && timeLogged) {
        bot.sendMessage(chatId, `Готово. Время <b>${fmt(elapsed)}</b> залогировано в Zoho, задача закрыта.`, { parse_mode: "HTML" });
      } else if (taskClosed && elapsed <= 60) {
        bot.sendMessage(chatId, `Задача закрыта в Zoho.\nВремя не залогировано, потому что прошло меньше минуты.`);
      } else if (taskClosed) {
        bot.sendMessage(chatId, `Задача закрыта в Zoho.\nНе удалось залогировать время (${fmt(elapsed)}).\n\n<code>${timeErrMsg}</code>`, { parse_mode: "HTML" });
      } else {
        bot.sendMessage(chatId, `Не удалось закрыть задачу в Zoho.\n\n<code>${closeErrMsg}</code>`, { parse_mode: "HTML" });
      }
    } catch (e) {
      bot.sendMessage(chatId, `Ошибка Zoho: ${e.message}`);
    }

    try {
      const updated = await getTgTask(db, taskId);
      await updateTaskMessage(db, updated);
    } catch (_) {}
    return;
  }

  // в”Ђв”Ђ РќРѕРІС‹Р№ РїРѕРёСЃРє в”Ђв”Ђ
  if (data.startsWith("search_again_")) {
    const mode = data.slice(13);
    const session = sessions.get(chatId) || {};
    sessions.set(chatId, { ...session, state: "search_project", mode });
    await cleanSend(chatId, "Введите название проекта для поиска:", { parse_mode: "HTML" });
    return;
  }

  // в”Ђв”Ђ Р’С‹Р±РѕСЂ РїСЂРѕРµРєС‚Р° РїСЂРё СЃРѕР·РґР°РЅРёРё РЅРѕРІРѕР№ Р·Р°РґР°С‡Рё в”Ђв”Ђ
  if (data.startsWith("newtask_proj_")) {
    const projectId = data.slice(13);
    const session = sessions.get(chatId) || {};
    const project = session.projects?.find((p) => p.id === projectId);
    sessions.set(chatId, { state: "newtask_enter_title", projectId, project });
    await cleanSend(chatId, `Проект: <b>${project?.name}</b>\n\nВведите название задачи:`, { parse_mode: "HTML" });
    return;
  }

  // в”Ђв”Ђ Р’С‹Р±РѕСЂ РёСЃРїРѕР»РЅРёС‚РµР»СЏ РїСЂРё СЃРѕР·РґР°РЅРёРё РЅРѕРІРѕР№ Р·Р°РґР°С‡Рё в”Ђв”Ђ
  if (data.startsWith("newtask_assign_")) {
    const idx = parseInt(data.slice(15), 10);
    const session = sessions.get(chatId) || {};
    const assignee = session.users?.[idx];

    // РќР°Р№С‚Рё chat_id РёСЃРїРѕР»РЅРёС‚РµР»СЏ РїРѕ email
    const db2 = getDb();
    let assigneeChatId = String(chatId); // fallback вЂ” СЃРѕР·РґР°С‚РµР»СЋ
    if (assignee?.email) {
      const tgQ = await db2.query(`SELECT chat_id FROM tg_users WHERE LOWER(email)=LOWER($1)`, [assignee.email]);
      if (tgQ.rows?.[0]) assigneeChatId = tgQ.rows[0].chat_id;
    }

    const zohoUser = await getZohoUserForChat(db2, chatId);
    await cleanSend(chatId, "Создаю задачу в Zoho...");
    try {
      const created = await createZohoTask(db2, zohoUser, session.projectId, {
        name: session.title,
        owner_id: assignee?.portal_id || assignee?.id || "",
      });

      const taskRow = {
        id: uid(),
        zoho_project_id: session.projectId,
        zoho_project_name: session.project?.name || "",
        zoho_task_id: created.id,
        zoho_task_name: created.name || session.title,
        assignee_chat_id: assigneeChatId,
        creator_chat_id: String(chatId),
        elapsed_seconds: 0,
        status: "pending",
        created_at: new Date().toISOString(),
      };

      await db2.query(
        `INSERT INTO tg_tasks (id,zoho_project_id,zoho_project_name,zoho_task_id,zoho_task_name,assignee_chat_id,creator_chat_id,elapsed_seconds,status,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [taskRow.id, taskRow.zoho_project_id, taskRow.zoho_project_name, taskRow.zoho_task_id,
         taskRow.zoho_task_name, taskRow.assignee_chat_id, taskRow.creator_chat_id,
         0, "pending", taskRow.created_at]
      );

      sessions.delete(chatId);
      bot.sendMessage(chatId, `Задача создана в Zoho и отправлена исполнителю.`);

      // РћС‚РїСЂР°РІРёС‚СЊ РёСЃРїРѕР»РЅРёС‚РµР»СЋ (РµСЃР»Рё РЅРµ СЃР°Рј СЃРµР±Рµ)
      await sendTaskToAssignee(db2, assigneeChatId, taskRow);
      if (assigneeChatId !== String(chatId)) {
        bot.sendMessage(chatId,
          `Задача отправлена: <b>${assignee?.name || assignee?.email}</b>`,
          { parse_mode: "HTML" }
        );
      }
    } catch (e) {
      console.error("[Bot] Task create error:", e);
      bot.sendMessage(chatId, `Ошибка создания задачи: ${e.message}\n<code>${e.cause?.message || e.code || ""}</code>`, { parse_mode: "HTML" });
    }
    return;
  }
}

// в”Ђв”Ђ Text message handler в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
async function handleText(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  const session = sessions.get(chatId);
  const db = getDb();

  // в”Ђв”Ђ РљРЅРѕРїРєРё РіР»Р°РІРЅРѕРіРѕ РјРµРЅСЋ в”Ђв”Ђ
  if (matchesAny(text, ["Создать задачу", "Create task", "РЎРѕР·РґР°С‚СЊ", "➕", "+"])) return handleNewTask(chatId);
  if (matchesAny(text, ["Проекты", "Projects", "Проект", "РџСЂРѕРµРєС‚"])) return handleProjects(chatId);
  if (matchesAny(text, ["Мой профиль", "Профиль", "My profile", "РџСЂРѕС„РёР»СЊ"])) return handleProfile(chatId);
  if (matchesAny(text, ["Подключить Zoho", "Connect Zoho", "Zoho", "РџРѕРґРєР»СЋС‡РёС‚СЊ Zoho"])) return handleConnectZoho(chatId);
  if (matchesAny(text, ["Статистика", "Stats", "РЎС‚Р°С‚РёСЃС‚РёРєР°"])) return handleStats(chatId);
  if (matchesAny(text, ["Помощь", "Help", "РџРѕРјРѕС‰СЊ"])) return handleHelp(chatId);

  // в”Ђв”Ђ РџРѕРёСЃРє РїСЂРѕРµРєС‚Р° в”Ђв”Ђ
  if (session?.state === "search_project") {
    await showFilteredProjects(chatId, session.projects, text, session.mode);
    return;
  }

  // в”Ђв”Ђ Р РµРіРёСЃС‚СЂР°С†РёСЏ email в”Ђв”Ђ
  if (session?.state === "await_email") {
    const email = text.toLowerCase();
    if (!email.includes("@")) return bot.sendMessage(chatId, "Введите корректный email:");
    await saveTgUser(db, chatId, session.name, email);
    sessions.delete(chatId);
    return bot.sendMessage(chatId,
      `Готово. Вы зарегистрированы как <b>${session.name}</b> (${email}).\n\nВыберите действие:`,
      MAIN_MENU
    );
  }

  // в”Ђв”Ђ РЎРјРµРЅР° email РёР· РїСЂРѕС„РёР»СЏ в”Ђв”Ђ
  if (!session && text.includes("@") && text.includes(".")) {
    const user = await getTgUser(db, chatId);
    if (user) {
      await saveTgUser(db, chatId, user.name, text.toLowerCase());
      return bot.sendMessage(chatId, `Email обновлён: ${text.toLowerCase()}`);
    }
  }

  // в”Ђв”Ђ Р’РІРѕРґ РЅР°Р·РІР°РЅРёСЏ РЅРѕРІРѕР№ Р·Р°РґР°С‡Рё в”Ђв”Ђ
  if (session?.state === "newtask_enter_title") {
    sessions.set(chatId, { ...session, state: "newtask_select_assignee", title: text });
    await cleanSend(chatId, "Загружаю участников проекта...");
    try {
      const zohoUser = await getZohoUser(db);
      const allUsers = await fetchZohoProjectUsers(db, zohoUser, session.projectId);
      const tgUser = await getTgUser(db, chatId);

      // РџРѕРєР°Р·С‹РІР°РµРј С‚РѕР»СЊРєРѕ СЃРµР±СЏ (РїРѕ email РёР· СЂРµРіРёСЃС‚СЂР°С†РёРё)
      const users = tgUser?.email
        ? allUsers.filter((u) => u.email.toLowerCase() === tgUser.email.toLowerCase())
        : allUsers;

      if (!users.length) return cleanSend(chatId, "Ваш email не найден среди участников этого проекта. Попросите администратора добавить вас в Zoho.");

      sessions.set(chatId, { ...sessions.get(chatId), users });
      const keyboard = {
        inline_keyboard: users.map((u, idx) => ([
          { text: `${u.name} (${u.email})`, callback_data: `newtask_assign_${idx}` },
        ])),
      };
      await cleanSend(chatId, "Подтвердите исполнителя:", { reply_markup: keyboard });
    } catch (e) {
      cleanSend(chatId, `Ошибка: ${e.message}`);
    }
    return;
  }
}

function safe(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      console.error("[Bot] Unhandled error:", e);
    }
  };
}

function registerHandlers() {
  bot.onText(/\/start/, safe(handleStart));
  bot.onText(/\/projects/, safe((msg) => handleProjects(msg.chat.id)));
  bot.onText(/\/newtask/, safe((msg) => handleNewTask(msg.chat.id)));
  bot.on("callback_query", safe(handleCallback));
  bot.on("message", safe((msg) => {
    if (msg.text && !msg.text.startsWith("/")) return handleText(msg);
  }));
}

process.on("uncaughtException", (e) => console.error("[Bot] uncaughtException:", e));
process.on("unhandledRejection", (e) => console.error("[Bot] unhandledRejection:", e));

// в”Ђв”Ђ Init bot в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
export function startBot(app) {
  if (!TOKEN) {
    console.warn("[Bot] TELEGRAM_BOT_TOKEN not set вЂ” bot disabled");
    return;
  }

  const appUrl = String(process.env.APP_BASE_URL || "").replace(/\/+$/, "");

  if (appUrl) {
    // в”Ђв”Ђ Webhook mode (production) в”Ђв”Ђ
    bot = new TelegramBot(TOKEN, { polling: false });
    registerHandlers();

    const webhookUrl = `${appUrl}/api/bot-webhook`;
    bot.setWebHook(webhookUrl)
      .then(() => console.log(`[Bot] Webhook set: ${webhookUrl}`))
      .catch((e) => console.error("[Bot] Failed to set webhook:", e.message));

    app.post("/api/bot-webhook", (req, res) => {
      bot.processUpdate(req.body);
      res.sendStatus(200);
    });

    console.log("[Bot] Webhook mode");
  } else {
    // в”Ђв”Ђ Polling mode (local dev) в”Ђв”Ђ
    bot = new TelegramBot(TOKEN, { polling: true });
    registerHandlers();
    bot.on("polling_error", (e) => console.error("[Bot] polling error:", e.message));
    console.log("[Bot] Polling mode");
  }

  process.on("SIGTERM", () => {
    console.log("[Bot] SIGTERM вЂ” shutting down");
    (bot.isPolling() ? bot.stopPolling() : Promise.resolve()).then(() => process.exit(0));
  });

  const GROUP_ID = process.env.TELEGRAM_CHAT_ID;

  const remindedTasks = new Set(); // Р·Р°РґР°С‡Рё, РїРѕ РєРѕС‚РѕСЂС‹Рј СѓР¶Рµ РѕС‚РїСЂР°РІРёР»Рё РЅР°РїРѕРјРёРЅР°РЅРёРµ Рѕ РґРѕР»РіРѕРј С‚Р°Р№РјРµСЂРµ


  const mondayJokes = [
    "Monday: five days until the weekend. Let's go.",
    "A new week means new progress.",
    "Monday is a good day to start strong.",
    "One task at a time, one win at a time.",
  ];

  // в”Ђв”Ђ РЈС‚СЂРµРЅРЅРµРµ РЅР°РїРѕРјРёРЅР°РЅРёРµ: 10:00 Р”СѓР±Р°Р№ (UTC+4 = 06:00 UTC), РїРЅвЂ“РїС‚ в”Ђв”Ђ
  cron.schedule("0 6 * * 1-5", () => {
    if (!GROUP_ID) return;
    const day = new Date().getDay(); // 1 = РїРѕРЅРµРґРµР»СЊРЅРёРє
    if (day === 1) {
      const joke = mondayJokes[Math.floor(Math.random() * mondayJokes.length)];
      bot.sendMessage(GROUP_ID,
        `<b>С понедельником, команда.</b>\n\n` +
        `${joke}\n\n` +
        `Откройте бота, создайте задачи и запускайте таймер, когда начинаете работу.\n\n` +
        `Напишите мне в личные сообщения и выберите <b>Создать задачу</b>.`,
        { parse_mode: "HTML" }
      );
    } else {
      bot.sendMessage(GROUP_ID,
        `<b>Доброе утро, команда.</b>\n\n` +
        `Пожалуйста, откройте задачи на сегодня и запустите таймер, когда начнёте работу.\n\n` +
        `Напишите мне в личные сообщения и выберите <b>Создать задачу</b>.`,
        { parse_mode: "HTML" }
      );
    }
    console.log("[Bot] Sent morning reminder");
  });

  // в”Ђв”Ђ Р’РµС‡РµСЂРЅРµРµ РЅР°РїРѕРјРёРЅР°РЅРёРµ: 19:00 Р”СѓР±Р°Р№ (UTC+4 = 15:00 UTC), РїРЅвЂ“РїС‚ в”Ђв”Ђ
  cron.schedule("0 15 * * 1-5", () => {
    if (!GROUP_ID) return;
    bot.sendMessage(GROUP_ID,
      `<b>Конец рабочего дня.</b>\n\n` +
      `Пожалуйста, закройте все активные задачи в боте, чтобы время ушло в Zoho.\n\n` +
      `Хорошего вечера.`,
      { parse_mode: "HTML" }
    );
    console.log("[Bot] Sent evening reminder");
  });

  // в”Ђв”Ђ РџСЏС‚РЅРёС‡РЅС‹Р№ РѕС‚С‡С‘С‚: 18:00 Р”СѓР±Р°Р№ (UTC+4 = 14:00 UTC) в”Ђв”Ђ
  cron.schedule("0 14 * * 5", async () => {
    if (!GROUP_ID) return;
    const db = getDb();
    try {
      const monday = new Date();
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      monday.setHours(0, 0, 0, 0);

      const q = await db.query(`
        SELECT u.name, t.assignee_chat_id,
               COUNT(*) AS tasks,
               COALESCE(SUM(t.elapsed_seconds), 0) AS seconds
        FROM tg_tasks t
        LEFT JOIN tg_users u ON u.chat_id = t.assignee_chat_id
        WHERE t.status='done' AND t.created_at >= $1
        GROUP BY t.assignee_chat_id, u.name
        ORDER BY seconds DESC
      `, [monday.toISOString()]);

      if (!q.rows.length) return;

      const medals = ["1.", "2.", "3."];
      const lines = q.rows.map((r, i) =>
        `${medals[i] || "-"} <b>${r.name || "Неизвестно"}</b> — ${fmt(Number(r.seconds))} (${r.tasks} задач)`
      ).join("\n");

      const winner = q.rows[0];
      bot.sendMessage(GROUP_ID,
        `<b>Итоги недели</b>\n\n` +
        `${lines}\n\n` +
        `Лучший результат недели: <b>${winner.name || "Неизвестно"}</b> — ${fmt(Number(winner.seconds))} залогировано.\n\n` +
        `Отличная работа, команда. Хороших выходных.`,
        { parse_mode: "HTML" }
      );
    } catch (e) {
      console.error("[Bot] Weekly report error:", e.message);
    }
  });
}
