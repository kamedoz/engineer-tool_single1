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
      [{ text: "вћ• РЎРѕР·РґР°С‚СЊ Р·Р°РґР°С‡Сѓ" }, { text: "рџ“Ѓ РџСЂРѕРµРєС‚С‹" }],
      [{ text: "рџ‘¤ РњРѕР№ РїСЂРѕС„РёР»СЊ"   }, { text: "рџ”— РџРѕРґРєР»СЋС‡РёС‚СЊ Zoho" }],
      [{ text: "рџ“Љ РЎС‚Р°С‚РёСЃС‚РёРєР°"    }, { text: "вќ“ РџРѕРјРѕС‰СЊ" }],
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
  const status = task.status === "running" ? "рџџў РРґС‘С‚" : task.status === "paused" ? "вЏё РџР°СѓР·Р°" : task.status === "done" ? "вњ… Р—Р°РєСЂС‹С‚Р°" : "вЏі РћР¶РёРґР°РµС‚";
  return (
    `рџ“‹ <b>${task.zoho_task_name}</b>\n` +
    `рџ“Ѓ РџСЂРѕРµРєС‚: ${task.zoho_project_name}\n` +
    `${status}\n` +
    `вЏ± Р’СЂРµРјСЏ: <b>${fmt(elapsed)}</b>`
  );
}

function taskKeyboard(taskId, status) {
  if (status === "done") return { inline_keyboard: [] };
  if (status === "running") {
    return {
      inline_keyboard: [[
        { text: "вЏё РџР°СѓР·Р°", callback_data: `pause_${taskId}` },
        { text: "вњ… Р—Р°РєСЂС‹С‚СЊ Р·Р°РґР°С‡Сѓ", callback_data: `close_${taskId}` },
      ]],
    };
  }
  return {
    inline_keyboard: [[
      { text: "в–¶пёЏ РЎС‚Р°СЂС‚", callback_data: `start_${taskId}` },
      { text: "вњ… Р—Р°РєСЂС‹С‚СЊ Р·Р°РґР°С‡Сѓ", callback_data: `close_${taskId}` },
    ]],
  };
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
    await cleanSend(chatId, "Zoho is not connected. Please connect Zoho in the bot first.");
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
      ? "\n\nIf files are missing, reconnect Zoho in the bot to refresh file permissions."
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
    await cleanSend(chatId, "Zoho is not connected. Please connect Zoho in the bot first.");
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
    await cleanSend(chatId, "Zoho is not connected. Please connect Zoho in the bot first.");
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
      `Could not send the file.\n\n${e.message}\n\nReconnect Zoho in the bot if this connection is old.`
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
    await cleanSend(chatId, "Zoho is not connected. Please connect Zoho in the bot first.");
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
      `Could not send the file.\n\n${e.message}\n\nReconnect Zoho in the bot if this connection is old.`
    );
  }
}

async function handleStart(msg) {
  const chatId = msg.chat.id;
  const db = getDb();
  const existing = await getTgUser(db, chatId);
  if (existing) {
    return bot.sendMessage(chatId,
      `рџ‘‹ РЎ РІРѕР·РІСЂР°С‰РµРЅРёРµРј, <b>${existing.name}</b>!\n\nР’С‹Р±РµСЂРё РґРµР№СЃС‚РІРёРµ:`,
      MAIN_MENU
    );
  }
  const name = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") || "User";
  sessions.set(chatId, { state: "await_email", name });
  bot.sendMessage(chatId,
    `рџ‘‹ РџСЂРёРІРµС‚, <b>${name}</b>!\n\nР’РІРµРґРё СЃРІРѕР№ email (РєР°Рє РІ Zoho), С‡С‚РѕР±С‹ СЏ РјРѕРі РЅР°Р·РЅР°С‡Р°С‚СЊ С‚РµР±Рµ Р·Р°РґР°С‡Рё:`,
    { parse_mode: "HTML" }
  );
}

// в”Ђв”Ђ РџСЂРѕС„РёР»СЊ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
async function handleProfile(chatId) {
  const db = getDb();
  const user = await getTgUser(db, chatId);
  if (!user) return bot.sendMessage(chatId, "РўС‹ РµС‰С‘ РЅРµ Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅ. РќР°Р¶РјРё /start");
  bot.sendMessage(chatId,
    `рџ‘¤ <b>РџСЂРѕС„РёР»СЊ</b>\n\n` +
    `РРјСЏ: ${user.name}\n` +
    `Email: ${user.email}\n\n` +
    `Р”Р»СЏ СЃРјРµРЅС‹ email вЂ” РЅР°РїРёС€Рё РЅРѕРІС‹Р№ email СЃСЋРґР°.`,
    { parse_mode: "HTML" }
  );
}

// в”Ђв”Ђ РџРѕРґРєР»СЋС‡РёС‚СЊ Zoho в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
async function handleConnectZoho(chatId) {
  const db = getDb();
  const tgUser = await getTgUser(db, chatId);
  if (!tgUser) {
    return bot.sendMessage(chatId, "РЎРЅР°С‡Р°Р»Р° Р·Р°СЂРµРіРёСЃС‚СЂРёСЂСѓР№СЃСЏ вЂ” РЅР°Р¶РјРё /start");
  }
  try {
    const url = buildZohoAuthUrlForBot(chatId);
    const isConnected = Boolean(tgUser.zoho_refresh_token);
    bot.sendMessage(chatId,
      (isConnected
        ? `вњ… Zoho СѓР¶Рµ РїРѕРґРєР»СЋС‡С‘РЅ.\n\nР•СЃР»Рё С…РѕС‡РµС€СЊ РїРµСЂРµРїРѕРґРєР»СЋС‡РёС‚СЊ Р°РєРєР°СѓРЅС‚ вЂ” РЅР°Р¶РјРё РєРЅРѕРїРєСѓ РЅРёР¶Рµ.`
        : `рџ”— <b>РџРѕРґРєР»СЋС‡Рё СЃРІРѕР№ Zoho-Р°РєРєР°СѓРЅС‚</b>\n\nРџРѕСЃР»Рµ РїРѕРґРєР»СЋС‡РµРЅРёСЏ Р·Р°РґР°С‡Рё Р±СѓРґСѓС‚ СЃРѕР·РґР°РІР°С‚СЊСЃСЏ Рё Р·Р°РєСЂС‹РІР°С‚СЊСЃСЏ РѕС‚ С‚РІРѕРµРіРѕ РёРјРµРЅРё.`) +
      `\n\n<a href="${url}">рџ‘‰ РќР°Р¶РјРё СЃСЋРґР° РґР»СЏ Р°РІС‚РѕСЂРёР·Р°С†РёРё РІ Zoho</a>`,
      { parse_mode: "HTML", disable_web_page_preview: true }
    );
  } catch (e) {
    bot.sendMessage(chatId, `вќЊ РћС€РёР±РєР°: ${e.message}`);
  }
}

// в”Ђв”Ђ РЎС‚Р°С‚РёСЃС‚РёРєР° в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
async function handleStats(chatId) {
  const db = getDb();
  const user = await getTgUser(db, chatId);
  if (!user) return bot.sendMessage(chatId, "РЎРЅР°С‡Р°Р»Р° Р·Р°СЂРµРіРёСЃС‚СЂРёСЂСѓР№СЃСЏ вЂ” РЅР°Р¶РјРё /start");

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
    `рџ“Љ <b>РўРІРѕСЏ СЃС‚Р°С‚РёСЃС‚РёРєР°</b>\n\n` +
    `<b>Р­С‚Р° РЅРµРґРµР»СЏ:</b>\n` +
    `вЂў Р—Р°РґР°С‡ Р·Р°РєСЂС‹С‚Рѕ: ${s.week_tasks}\n` +
    `вЂў Р’СЂРµРјСЏ Р·Р°Р»РѕРіРёСЂРѕРІР°РЅРѕ: ${fmt(Number(s.week_seconds))}\n\n` +
    `<b>Р­С‚РѕС‚ РјРµСЃСЏС†:</b>\n` +
    `вЂў Р—Р°РґР°С‡ Р·Р°РєСЂС‹С‚Рѕ: ${s.month_tasks}\n` +
    `вЂў Р’СЂРµРјСЏ Р·Р°Р»РѕРіРёСЂРѕРІР°РЅРѕ: ${fmt(Number(s.month_seconds))}\n\n` +
    `<b>Р—Р° РІСЃС‘ РІСЂРµРјСЏ:</b>\n` +
    `вЂў Р—Р°РґР°С‡ Р·Р°РєСЂС‹С‚Рѕ: ${s.all_tasks}\n` +
    `вЂў Р’СЂРµРјСЏ Р·Р°Р»РѕРіРёСЂРѕРІР°РЅРѕ: ${fmt(Number(s.all_seconds))}`,
    { parse_mode: "HTML" }
  );
}

// в”Ђв”Ђ РџРѕРјРѕС‰СЊ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
function handleHelp(chatId) {
  bot.sendMessage(chatId,
    `вќ“ <b>РљР°Рє РїРѕР»СЊР·РѕРІР°С‚СЊСЃСЏ Р±РѕС‚РѕРј:</b>\n\n` +
    `вћ• <b>РЎРѕР·РґР°С‚СЊ Р·Р°РґР°С‡Сѓ</b> вЂ” РІС‹Р±РµСЂРё РїСЂРѕРµРєС‚, РІРІРµРґРё РЅР°Р·РІР°РЅРёРµ, РІС‹Р±РµСЂРё РёСЃРїРѕР»РЅРёС‚РµР»СЏ. Р—Р°РґР°С‡Р° РїРѕСЏРІРёС‚СЃСЏ РІ Zoho Рё РѕС‚РїСЂР°РІРёС‚СЃСЏ РёСЃРїРѕР»РЅРёС‚РµР»СЋ РІ Р»РёС‡РєСѓ.\n\n` +
    `рџ“Ѓ <b>РџСЂРѕРµРєС‚С‹</b> вЂ” РїСЂРѕСЃРјРѕС‚СЂ Р·Р°РґР°С‡ РїРѕ РїСЂРѕРµРєС‚Р°Рј. РќР°Р¶РјРё РЅР° Р·Р°РґР°С‡Сѓ, С‡С‚РѕР±С‹ РІР·СЏС‚СЊ РµС‘ СЃРµР±Рµ.\n\n` +
    `в–¶пёЏ <b>РЎС‚Р°СЂС‚ / вЏё РџР°СѓР·Р°</b> вЂ” СѓРїСЂР°РІР»РµРЅРёРµ С‚Р°Р№РјРµСЂРѕРј РїСЂСЏРјРѕ РІ СЃРѕРѕР±С‰РµРЅРёРё.\n\n` +
    `вњ… <b>Р—Р°РєСЂС‹С‚СЊ Р·Р°РґР°С‡Сѓ</b> вЂ” РІСЂРµРјСЏ СѓР»РµС‚Р°РµС‚ РІ Zoho, Р·Р°РґР°С‡Р° Р·Р°РєСЂС‹РІР°РµС‚СЃСЏ.`,
    { parse_mode: "HTML" }
  );
}

// в”Ђв”Ђ /projects в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
async function handleProjects(chatId) {
  const db = getDb();
  const zohoUser = await getZohoUser(db);
  if (!zohoUser) return cleanSend(chatId, "вќЊ Zoho РЅРµ РїРѕРґРєР»СЋС‡С‘РЅ.");
  await cleanSend(chatId, "вЏі Р—Р°РіСЂСѓР¶Р°СЋ РїСЂРѕРµРєС‚С‹...");
  try {
    const projects = await fetchZohoProjects(db, zohoUser);
    if (!projects.length) return cleanSend(chatId, "РџСЂРѕРµРєС‚РѕРІ РЅРµ РЅР°Р№РґРµРЅРѕ.");
    sessions.set(chatId, { ...sessions.get(chatId), state: "search_project", projects, mode: "view" });
    await cleanSend(chatId,
      `рџ”Ќ РќР°Р№РґРµРЅРѕ РїСЂРѕРµРєС‚РѕРІ: <b>${projects.length}</b>\n\nР’РІРµРґРё РЅР°Р·РІР°РЅРёРµ (РёР»Рё С‡Р°СЃС‚СЊ) РґР»СЏ РїРѕРёСЃРєР°:`,
      { parse_mode: "HTML" }
    );
  } catch (e) {
    cleanSend(chatId, `вќЊ РћС€РёР±РєР°: ${e.message}`);
  }
}

// в”Ђв”Ђ РџРѕРєР°Р·Р°С‚СЊ РѕС‚С„РёР»СЊС‚СЂРѕРІР°РЅРЅС‹Рµ РїСЂРѕРµРєС‚С‹ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
async function showFilteredProjects(chatId, projects, query, mode) {
  const filtered = query
    ? projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    : projects;

  if (!filtered.length) {
    return cleanSend(chatId,
      `вќЊ РџСЂРѕРµРєС‚ "<b>${query}</b>" РЅРµ РЅР°Р№РґРµРЅ.\nРџРѕРїСЂРѕР±СѓР№ РґСЂСѓРіРѕРµ РЅР°Р·РІР°РЅРёРµ:`,
      { parse_mode: "HTML" }
    );
  }

  const prefix = mode === "newtask" ? "newtask_proj_" : "proj_";
  const keyboard = {
    inline_keyboard: [
      ...filtered.slice(0, 20).map((p) => ([
        { text: `рџ“Ѓ ${p.name}`, callback_data: `${prefix}${p.id}` },
      ])),
      [{ text: "рџ”Ќ РќРѕРІС‹Р№ РїРѕРёСЃРє", callback_data: `search_again_${mode}` }],
    ],
  };
  await cleanSend(chatId,
    filtered.length === projects.length
      ? `рџ“Ѓ Р’СЃРµ РїСЂРѕРµРєС‚С‹ (${filtered.length}):`
      : `рџ“Ѓ РќР°Р№РґРµРЅРѕ: <b>${filtered.length}</b> РёР· ${projects.length}:`,
    { parse_mode: "HTML", reply_markup: keyboard }
  );
}

// в”Ђв”Ђ /newtask в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
async function handleNewTask(chatId) {
  const db = getDb();
  const zohoUser = await getZohoUser(db);
  if (!zohoUser) return bot.sendMessage(chatId, "вќЊ Zoho РЅРµ РїРѕРґРєР»СЋС‡С‘РЅ.");
  await cleanSend(chatId, "вЏі Р—Р°РіСЂСѓР¶Р°СЋ РїСЂРѕРµРєС‚С‹...");
  try {
    const projects = await fetchZohoProjects(db, zohoUser);
    if (!projects.length) return cleanSend(chatId, "РџСЂРѕРµРєС‚РѕРІ РЅРµ РЅР°Р№РґРµРЅРѕ.");
    sessions.set(chatId, { state: "search_project", projects, mode: "newtask" });
    await cleanSend(chatId,
      `рџ”Ќ РќР°Р№РґРµРЅРѕ РїСЂРѕРµРєС‚РѕРІ: <b>${projects.length}</b>\n\nР’РІРµРґРё РЅР°Р·РІР°РЅРёРµ (РёР»Рё С‡Р°СЃС‚СЊ) РґР»СЏ РїРѕРёСЃРєР°:`,
      { parse_mode: "HTML" }
    );
  } catch (e) {
    cleanSend(chatId, `вќЊ РћС€РёР±РєР°: ${e.message}`);
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
    await cleanSend(chatId, "вЏі Р—Р°РіСЂСѓР¶Р°СЋ Р·Р°РґР°С‡Рё...");
    try {
      const tasks = await fetchZohoTasks(db, zohoUser, projectId);
      const projects = await fetchZohoProjects(db, zohoUser);
      const project = projects.find((p) => p.id === projectId);
      if (!tasks.length) return cleanSend(chatId, "Р—Р°РґР°С‡ РІ РїСЂРѕРµРєС‚Рµ РЅРµС‚.");
      const keyboard = {
        inline_keyboard: tasks.map((t, idx) => ([
          { text: `рџ“Њ ${t.name}`, callback_data: `task_${projectId}_idx${idx}` },
        ])),
      };
      sessions.set(chatId, { state: "task_list", projectId, project, tasks });
      await cleanSend(chatId, `рџ“Ѓ <b>${project?.name}</b>\nР’С‹Р±РµСЂРё Р·Р°РґР°С‡Сѓ:`, {
        parse_mode: "HTML", reply_markup: keyboard,
      });
    } catch (e) {
      cleanSend(chatId, `вќЊ РћС€РёР±РєР°: ${e.message}`);
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
      zoho_task_name: task?.name || "Р—Р°РґР°С‡Р°",
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

    bot.sendMessage(chatId, `вЏі Р—Р°РєСЂС‹РІР°СЋ Р·Р°РґР°С‡Сѓ РІ Zoho Рё Р»РѕРіРёСЂСѓСЋ РІСЂРµРјСЏ <b>${fmt(elapsed)}</b>...`, { parse_mode: "HTML" });

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
            `Р Р°Р±РѕС‚Р° РЅР°Рґ Р·Р°РґР°С‡РµР№ (Telegram Р±РѕС‚)`,
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
        bot.sendMessage(chatId, `вњ… Р“РѕС‚РѕРІРѕ! Р’СЂРµРјСЏ <b>${fmt(elapsed)}</b> Р·Р°Р»РѕРіРёСЂРѕРІР°РЅРѕ РІ Zoho. Р—Р°РґР°С‡Р° Р·Р°РєСЂС‹С‚Р°.`, { parse_mode: "HTML" });
      } else if (taskClosed && elapsed <= 60) {
        bot.sendMessage(chatId, `вњ… Р—Р°РґР°С‡Р° Р·Р°РєСЂС‹С‚Р° РІ Zoho.\nР’СЂРµРјСЏ РЅРµ Р·Р°СЃС‡РёС‚Р°РЅРѕ вЂ” РјРµРЅСЊС€Рµ РјРёРЅСѓС‚С‹.`);
      } else if (taskClosed) {
        bot.sendMessage(chatId, `вњ… Р—Р°РґР°С‡Р° Р·Р°РєСЂС‹С‚Р° РІ Zoho.\nвљ пёЏ Р’СЂРµРјСЏ РЅРµ СѓРґР°Р»РѕСЃСЊ Р·Р°Р»РѕРіРёСЂРѕРІР°С‚СЊ (${fmt(elapsed)}).\n\n<code>${timeErrMsg}</code>`, { parse_mode: "HTML" });
      } else {
        bot.sendMessage(chatId, `вљ пёЏ РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РєСЂС‹С‚СЊ Р·Р°РґР°С‡Сѓ РІ Zoho.\n\n<code>${closeErrMsg}</code>`, { parse_mode: "HTML" });
      }
    } catch (e) {
      bot.sendMessage(chatId, `вљ пёЏ РћС€РёР±РєР° Zoho: ${e.message}`);
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
    await cleanSend(chatId, "рџ”Ќ Р’РІРµРґРё РЅР°Р·РІР°РЅРёРµ РїСЂРѕРµРєС‚Р° РґР»СЏ РїРѕРёСЃРєР°:", { parse_mode: "HTML" });
    return;
  }

  // в”Ђв”Ђ Р’С‹Р±РѕСЂ РїСЂРѕРµРєС‚Р° РїСЂРё СЃРѕР·РґР°РЅРёРё РЅРѕРІРѕР№ Р·Р°РґР°С‡Рё в”Ђв”Ђ
  if (data.startsWith("newtask_proj_")) {
    const projectId = data.slice(13);
    const session = sessions.get(chatId) || {};
    const project = session.projects?.find((p) => p.id === projectId);
    sessions.set(chatId, { state: "newtask_enter_title", projectId, project });
    await cleanSend(chatId, `рџ“Ѓ РџСЂРѕРµРєС‚: <b>${project?.name}</b>\n\nР’РІРµРґРё РЅР°Р·РІР°РЅРёРµ Р·Р°РґР°С‡Рё:`, { parse_mode: "HTML" });
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
    await cleanSend(chatId, "вЏі РЎРѕР·РґР°СЋ Р·Р°РґР°С‡Сѓ РІ Zoho...");
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
      bot.sendMessage(chatId, `вњ… Р—Р°РґР°С‡Р° СЃРѕР·РґР°РЅР° РІ Zoho Рё РѕС‚РїСЂР°РІР»РµРЅР° РёСЃРїРѕР»РЅРёС‚РµР»СЋ.`);

      // РћС‚РїСЂР°РІРёС‚СЊ РёСЃРїРѕР»РЅРёС‚РµР»СЋ (РµСЃР»Рё РЅРµ СЃР°Рј СЃРµР±Рµ)
      await sendTaskToAssignee(db2, assigneeChatId, taskRow);
      if (assigneeChatId !== String(chatId)) {
        bot.sendMessage(chatId,
          `рџ“Ё Р—Р°РґР°С‡Р° РѕС‚РїСЂР°РІР»РµРЅР°: <b>${assignee?.name || assignee?.email}</b>`,
          { parse_mode: "HTML" }
        );
      }
    } catch (e) {
      console.error("[Bot] Task create error:", e);
      bot.sendMessage(chatId, `вќЊ РћС€РёР±РєР° СЃРѕР·РґР°РЅРёСЏ Р·Р°РґР°С‡Рё: ${e.message}\n<code>${e.cause?.message || e.code || ""}</code>`, { parse_mode: "HTML" });
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
  if (text === "вћ• РЎРѕР·РґР°С‚СЊ Р·Р°РґР°С‡Сѓ")  return handleNewTask(chatId);
  if (text === "рџ“Ѓ РџСЂРѕРµРєС‚С‹")        return handleProjects(chatId);
  if (text === "рџ‘¤ РњРѕР№ РїСЂРѕС„РёР»СЊ")    return handleProfile(chatId);
  if (text === "рџ”— РџРѕРґРєР»СЋС‡РёС‚СЊ Zoho") return handleConnectZoho(chatId);
  if (text === "рџ“Љ РЎС‚Р°С‚РёСЃС‚РёРєР°")     return handleStats(chatId);
  if (text === "вќ“ РџРѕРјРѕС‰СЊ")         return handleHelp(chatId);

  // в”Ђв”Ђ РџРѕРёСЃРє РїСЂРѕРµРєС‚Р° в”Ђв”Ђ
  if (session?.state === "search_project") {
    await showFilteredProjects(chatId, session.projects, text, session.mode);
    return;
  }

  // в”Ђв”Ђ Р РµРіРёСЃС‚СЂР°С†РёСЏ email в”Ђв”Ђ
  if (session?.state === "await_email") {
    const email = text.toLowerCase();
    if (!email.includes("@")) return bot.sendMessage(chatId, "Р’РІРµРґРё РєРѕСЂСЂРµРєС‚РЅС‹Р№ email:");
    await saveTgUser(db, chatId, session.name, email);
    sessions.delete(chatId);
    return bot.sendMessage(chatId,
      `вњ… Р“РѕС‚РѕРІРѕ! РўС‹ Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅ РєР°Рє <b>${session.name}</b> (${email}).\n\nР’С‹Р±РµСЂРё РґРµР№СЃС‚РІРёРµ:`,
      MAIN_MENU
    );
  }

  // в”Ђв”Ђ РЎРјРµРЅР° email РёР· РїСЂРѕС„РёР»СЏ в”Ђв”Ђ
  if (!session && text.includes("@") && text.includes(".")) {
    const user = await getTgUser(db, chatId);
    if (user) {
      await saveTgUser(db, chatId, user.name, text.toLowerCase());
      return bot.sendMessage(chatId, `вњ… Email РѕР±РЅРѕРІР»С‘РЅ: ${text.toLowerCase()}`);
    }
  }

  // в”Ђв”Ђ Р’РІРѕРґ РЅР°Р·РІР°РЅРёСЏ РЅРѕРІРѕР№ Р·Р°РґР°С‡Рё в”Ђв”Ђ
  if (session?.state === "newtask_enter_title") {
    sessions.set(chatId, { ...session, state: "newtask_select_assignee", title: text });
    await cleanSend(chatId, "вЏі Р—Р°РіСЂСѓР¶Р°СЋ СѓС‡Р°СЃС‚РЅРёРєРѕРІ РїСЂРѕРµРєС‚Р°...");
    try {
      const zohoUser = await getZohoUser(db);
      const allUsers = await fetchZohoProjectUsers(db, zohoUser, session.projectId);
      const tgUser = await getTgUser(db, chatId);

      // РџРѕРєР°Р·С‹РІР°РµРј С‚РѕР»СЊРєРѕ СЃРµР±СЏ (РїРѕ email РёР· СЂРµРіРёСЃС‚СЂР°С†РёРё)
      const users = tgUser?.email
        ? allUsers.filter((u) => u.email.toLowerCase() === tgUser.email.toLowerCase())
        : allUsers;

      if (!users.length) return cleanSend(chatId, "вќЊ РўРІРѕР№ email РЅРµ РЅР°Р№РґРµРЅ РІ СѓС‡Р°СЃС‚РЅРёРєР°С… СЌС‚РѕРіРѕ РїСЂРѕРµРєС‚Р°. РџРѕРїСЂРѕСЃРё Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР° РґРѕР±Р°РІРёС‚СЊ С‚РµР±СЏ РІ Zoho.");

      sessions.set(chatId, { ...sessions.get(chatId), users });
      const keyboard = {
        inline_keyboard: users.map((u, idx) => ([
          { text: `рџ‘¤ ${u.name} (${u.email})`, callback_data: `newtask_assign_${idx}` },
        ])),
      };
      await cleanSend(chatId, "рџ‘¤ РџРѕРґС‚РІРµСЂРґРё РёСЃРїРѕР»РЅРёС‚РµР»СЏ:", { reply_markup: keyboard });
    } catch (e) {
      cleanSend(chatId, `вќЊ РћС€РёР±РєР°: ${e.message}`);
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

  // в”Ђв”Ђ РЈРІРµРґРѕРјР»РµРЅРёРµ РѕР± РѕР±РЅРѕРІР»РµРЅРёРё в”Ђв”Ђ
  if (GROUP_ID) {
    const appUrl = String(process.env.APP_BASE_URL || "").replace(/\/+$/, "");
    bot.sendMessage(GROUP_ID,
      `рџ”„ <b>Engineer Tool РѕР±РЅРѕРІР»С‘РЅ!</b>\n\n` +
      `рџ†• <b>Р§С‚Рѕ РЅРѕРІРѕРіРѕ:</b>\n` +
      `вЂў рџЊ† РќР°РїРѕРјРёРЅР°РЅРёРµ Рѕ РєРѕРЅС†Рµ СЂР°Р±РѕС‡РµРіРѕ РґРЅСЏ С‚РµРїРµСЂСЊ РїСЂРёС…РѕРґРёС‚ РІ <b>19:00</b> РїРѕ Р”СѓР±Р°СЋ\n` +
      `вЂў рџ“… Р’РµС‡РµСЂРЅРµРµ РЅР°РїРѕРјРёРЅР°РЅРёРµ С‚РµРїРµСЂСЊ СЂР°Р±РѕС‚Р°РµС‚ С‚РѕР»СЊРєРѕ <b>РїРѕ Р±СѓРґРЅСЏРј</b>\n` +
      `вЂў рџ§№ РЈРґР°Р»С‘РЅРЅС‹Рµ СЃРѕРѕР±С‰РµРЅРёСЏ РІ РѕР±С‰РµРј Рё Р»РёС‡РЅРѕРј С‡Р°С‚Рµ С‚РµРїРµСЂСЊ РёСЃС‡РµР·Р°СЋС‚ РїРѕР»РЅРѕСЃС‚СЊСЋ, Р±РµР· С‚РµРєСЃС‚Р° <code>[message deleted]</code>\n\n` +
      (appUrl ? `рџ”— <a href="${appUrl}">РћС‚РєСЂС‹С‚СЊ Engineer Tool</a>` : `вњ… РћР±РЅРѕРІР»РµРЅРёРµ РїСЂРёРјРµРЅРµРЅРѕ`),
      { parse_mode: "HTML" }
    );
  }

  const remindedTasks = new Set(); // Р·Р°РґР°С‡Рё, РїРѕ РєРѕС‚РѕСЂС‹Рј СѓР¶Рµ РѕС‚РїСЂР°РІРёР»Рё РЅР°РїРѕРјРёРЅР°РЅРёРµ Рѕ РґРѕР»РіРѕРј С‚Р°Р№РјРµСЂРµ


  const mondayJokes = [
    "РџРѕРЅРµРґРµР»СЊРЅРёРє вЂ” СЌС‚Рѕ РєРѕРіРґР° Р±СѓРґРёР»СЊРЅРёРє Р·РІРѕРЅРёС‚ РІ 7 СѓС‚СЂР°, Р° РѕСЂРіР°РЅРёР·Рј С€Р»С‘С‚ РµРіРѕ РєСѓРґР° РїРѕРґР°Р»СЊС€Рµ рџ“µ",
    "Р“РѕРІРѕСЂСЏС‚, РїРѕРЅРµРґРµР»СЊРЅРёРє вЂ” РґРµРЅСЊ С‚СЏР¶С‘Р»С‹Р№. РќРѕ РјС‹ Р¶Рµ РЅРµ РёС‰РµРј Р»С‘РіРєРёС… РїСѓС‚РµР№! рџ’Є",
    "РџРѕРЅРµРґРµР»СЊРЅРёРє: 5 РґРЅРµР№ РґРѕ РІС‹С…РѕРґРЅС‹С…. РќР°С‡РЅС‘Рј РѕС‚СЃС‡С‘С‚! рџљЂ",
    "РҐРѕСЂРѕС€Р°СЏ РЅРѕРІРѕСЃС‚СЊ вЂ” СЃРµРіРѕРґРЅСЏ РїРѕРЅРµРґРµР»СЊРЅРёРє, Р° Р·РЅР°С‡РёС‚ СЃР»РµРґСѓСЋС‰РёР№ РїРѕРЅРµРґРµР»СЊРЅРёРє РµС‰С‘ РґР°Р»РµРєРѕ рџ…",
    "РџРѕРЅРµРґРµР»СЊРЅРёРє вЂ” СЌС‚Рѕ РјР°Р»РµРЅСЊРєРёР№ РќРѕРІС‹Р№ РіРѕРґ. РќРѕРІР°СЏ РЅРµРґРµР»СЏ, РЅРѕРІС‹Рµ Р·Р°РґР°С‡Рё, РЅРѕРІС‹Рµ РїРѕР±РµРґС‹! рџЋЇ",
    "РќР°СѓРєР° РґРѕРєР°Р·Р°Р»Р°: РїРѕРЅРµРґРµР»СЊРЅРёРє РЅР°СЃС‚СѓРїР°РµС‚ РЅРµР·Р°РІРёСЃРёРјРѕ РѕС‚ С‚РѕРіРѕ, РіРѕС‚РѕРІ С‚С‹ Рє РЅРµРјСѓ РёР»Рё РЅРµС‚ рџ”¬",
    "РџРѕРЅРµРґРµР»СЊРЅРёРє РЅРµ С‚Р°РєРѕР№ СЃС‚СЂР°С€РЅС‹Р№, РµСЃР»Рё РІСЃС‚СЂРµС‚РёС‚СЊ РµРіРѕ СЃ Р·Р°РґР°С‡Р°РјРё РІ Zoho Рё РєРѕС„Рµ РІ СЂСѓРєРµ в•",
    "Р’СЃРµ РІРµР»РёРєРёРµ РґРµР»Р° РЅР°С‡РёРЅР°Р»РёСЃСЊ РІ РїРѕРЅРµРґРµР»СЊРЅРёРє. РќСѓ РёР»Рё РІРѕ РІС‚РѕСЂРЅРёРє, РєРѕРіРґР° РїРѕРЅРµРґРµР»СЊРЅРёРє СѓР¶Рµ РїСЂРѕС€С‘Р» рџ‚",
  ];

  // в”Ђв”Ђ РЈС‚СЂРµРЅРЅРµРµ РЅР°РїРѕРјРёРЅР°РЅРёРµ: 10:00 Р”СѓР±Р°Р№ (UTC+4 = 06:00 UTC), РїРЅвЂ“РїС‚ в”Ђв”Ђ
  cron.schedule("0 6 * * 1-5", () => {
    if (!GROUP_ID) return;
    const day = new Date().getDay(); // 1 = РїРѕРЅРµРґРµР»СЊРЅРёРє
    if (day === 1) {
      const joke = mondayJokes[Math.floor(Math.random() * mondayJokes.length)];
      bot.sendMessage(GROUP_ID,
        `рџЊ… <b>РЎ РїРѕРЅРµРґРµР»СЊРЅРёРєРѕРј, РєРѕРјР°РЅРґР°!</b>\n\n` +
        `${joke}\n\n` +
        `РќРѕРІР°СЏ РЅРµРґРµР»СЏ вЂ” РЅРѕРІС‹Рµ Р·Р°РґР°С‡Рё. РћС‚РєСЂС‹РІР°Р№ Р±РѕС‚, СЃРѕР·РґР°РІР°Р№ Р·Р°РґР°С‡Рё Рё Р·Р°РїСѓСЃРєР°Р№ С‚Р°Р№РјРµСЂ! рџ’ј\n` +
        `рџ“І РќР°РїРёС€РёС‚Рµ РјРЅРµ РІ Р»РёС‡РєСѓ в†’ <b>вћ• РЎРѕР·РґР°С‚СЊ Р·Р°РґР°С‡Сѓ</b>`,
        { parse_mode: "HTML" }
      );
    } else {
      bot.sendMessage(GROUP_ID,
        `рџЊ… <b>Р”РѕР±СЂРѕРµ СѓС‚СЂРѕ, РєРѕРјР°РЅРґР°!</b>\n\n` +
        `РќРµ Р·Р°Р±СѓРґСЊС‚Рµ РѕС‚РєСЂС‹С‚СЊ Р·Р°РґР°С‡Рё РЅР° СЃРµРіРѕРґРЅСЏ вЂ” Р·Р°РїСѓСЃС‚РёС‚Рµ С‚Р°Р№РјРµСЂ, РєР°Рє С‚РѕР»СЊРєРѕ РЅР°С‡РЅС‘С‚Рµ СЂР°Р±РѕС‚Сѓ.\n\n` +
        `рџ“І РќР°РїРёС€РёС‚Рµ РјРЅРµ РІ Р»РёС‡РєСѓ в†’ <b>вћ• РЎРѕР·РґР°С‚СЊ Р·Р°РґР°С‡Сѓ</b>`,
        { parse_mode: "HTML" }
      );
    }
    console.log("[Bot] Sent morning reminder");
  });

  // в”Ђв”Ђ Р’РµС‡РµСЂРЅРµРµ РЅР°РїРѕРјРёРЅР°РЅРёРµ: 19:00 Р”СѓР±Р°Р№ (UTC+4 = 15:00 UTC), РїРЅвЂ“РїС‚ в”Ђв”Ђ
  cron.schedule("0 15 * * 1-5", () => {
    if (!GROUP_ID) return;
    bot.sendMessage(GROUP_ID,
      `рџЊ† <b>РљРѕРЅРµС† СЂР°Р±РѕС‡РµРіРѕ РґРЅСЏ!</b>\n\n` +
      `РќРµ Р·Р°Р±СѓРґСЊС‚Рµ Р·Р°РєСЂС‹С‚СЊ РІСЃРµ Р°РєС‚РёРІРЅС‹Рµ Р·Р°РґР°С‡Рё вЂ” РЅР°Р¶РјРёС‚Рµ РєРЅРѕРїРєСѓ <b>вњ… Р—Р°РєСЂС‹С‚СЊ Р·Р°РґР°С‡Сѓ</b> РІ Р»РёС‡РєРµ Р±РѕС‚Р°, С‡С‚РѕР±С‹ РІСЂРµРјСЏ СѓС€Р»Рѕ РІ Zoho.\n\n` +
      `РҐРѕСЂРѕС€РµРіРѕ РІРµС‡РµСЂР°! рџ‘‹`,
      { parse_mode: "HTML" }
    );
    console.log("[Bot] Sent evening reminder");
  });

  // в”Ђв”Ђ РџСЂРѕРІРµСЂРєР° РґРѕР»РіРёС… С‚Р°Р№РјРµСЂРѕРІ: РєР°Р¶РґС‹Рµ 30 РјРёРЅСѓС‚ в”Ђв”Ђ
  cron.schedule("*/30 * * * *", async () => {
    const db = getDb();
    try {
      const cutoff = new Date(Date.now() - 4 * 3600 * 1000).toISOString();
      const q = await db.query(
        `SELECT * FROM tg_tasks WHERE status='running' AND timer_started_at < $1`,
        [cutoff]
      );
      for (const task of q.rows) {
        if (remindedTasks.has(task.id)) continue;
        remindedTasks.add(task.id);
        const elapsed = getElapsed(task);
        bot.sendMessage(task.assignee_chat_id,
          `вЏ° <b>РўР°Р№РјРµСЂ СЂР°Р±РѕС‚Р°РµС‚ СѓР¶Рµ ${fmt(elapsed)}!</b>\n\n` +
          `Р—Р°РґР°С‡Р° В«${task.zoho_task_name}В» РІСЃС‘ РµС‰С‘ Р°РєС‚РёРІРЅР°.\n` +
          `РќРµ Р·Р°Р±СѓРґСЊ РїРѕСЃС‚Р°РІРёС‚СЊ РЅР° РїР°СѓР·Сѓ РёР»Рё Р·Р°РєСЂС‹С‚СЊ.`,
          { parse_mode: "HTML" }
        ).catch(() => {});
      }
    } catch (e) {
      console.error("[Bot] Long timer check error:", e.message);
    }
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

      const medals = ["рџҐ‡", "рџҐ€", "рџҐ‰"];
      const lines = q.rows.map((r, i) =>
        `${medals[i] || "в–ЄпёЏ"} <b>${r.name || "РќРµРёР·РІРµСЃС‚РЅС‹Р№"}</b> вЂ” ${fmt(Number(r.seconds))} (${r.tasks} Р·Р°РґР°С‡)`
      ).join("\n");

      const winner = q.rows[0];
      bot.sendMessage(GROUP_ID,
        `рџЏ† <b>РС‚РѕРіРё РЅРµРґРµР»Рё!</b>\n\n` +
        `${lines}\n\n` +
        `рџЋ‰ Р Р°Р±РѕС‚СЏРіР° РЅРµРґРµР»Рё: <b>${winner.name || "РќРµРёР·РІРµСЃС‚РЅС‹Р№"}</b> вЂ” ${fmt(Number(winner.seconds))} Р·Р°Р»РѕРіРёСЂРѕРІР°РЅРѕ!\n\n` +
        `РћС‚Р»РёС‡РЅР°СЏ СЂР°Р±РѕС‚Р°, РєРѕРјР°РЅРґР°! РҐРѕСЂРѕС€РёС… РІС‹С…РѕРґРЅС‹С… рџЋ‰`,
        { parse_mode: "HTML" }
      );
    } catch (e) {
      console.error("[Bot] Weekly report error:", e.message);
    }
  });
}
