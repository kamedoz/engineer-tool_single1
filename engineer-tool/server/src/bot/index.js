// server/src/bot/index.js — Zoho Task Bot
import TelegramBot from "node-telegram-bot-api";
import cron from "node-cron";
import { getDb } from "../db.js";
import {
  fetchZohoProjects,
  fetchZohoTasks,
  fetchZohoProjectUsers,
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

// ── Главное меню (постоянная клавиатура) ─────────────────
const MAIN_MENU = {
  reply_markup: {
    keyboard: [
      [{ text: "➕ Создать задачу" }, { text: "📁 Проекты" }],
      [{ text: "👤 Мой профиль"   }, { text: "🔗 Подключить Zoho" }],
      [{ text: "📊 Статистика"    }, { text: "❓ Помощь" }],
    ],
    resize_keyboard: true,
    persistent: true,
  },
  parse_mode: "HTML",
};

// ── helpers ──────────────────────────────────────────────

// Удаляет предыдущее сообщение бота из сессии и отправляет новое
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
  const status = task.status === "running" ? "🟢 Идёт" : task.status === "paused" ? "⏸ Пауза" : task.status === "done" ? "✅ Закрыта" : "⏳ Ожидает";
  return (
    `📋 <b>${task.zoho_task_name}</b>\n` +
    `📁 Проект: ${task.zoho_project_name}\n` +
    `${status}\n` +
    `⏱ Время: <b>${fmt(elapsed)}</b>`
  );
}

function taskKeyboard(taskId, status) {
  if (status === "done") return { inline_keyboard: [] };
  if (status === "running") {
    return {
      inline_keyboard: [[
        { text: "⏸ Пауза", callback_data: `pause_${taskId}` },
        { text: "✅ Закрыть задачу", callback_data: `close_${taskId}` },
      ]],
    };
  }
  return {
    inline_keyboard: [[
      { text: "▶️ Старт", callback_data: `start_${taskId}` },
      { text: "✅ Закрыть задачу", callback_data: `close_${taskId}` },
    ]],
  };
}

// ── DB helpers ───────────────────────────────────────────
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

async function getZohoUser(db) {
  // Приоритет: admin с токеном
  const adminQ = await db.query(
    `SELECT * FROM users WHERE zoho_refresh_token IS NOT NULL AND role='admin' ORDER BY created_at LIMIT 1`
  );
  if (adminQ.rows?.[0]) return adminQ.rows[0];
  // Fallback: любой с токеном
  const anyQ = await db.query(
    `SELECT * FROM users WHERE zoho_refresh_token IS NOT NULL ORDER BY created_at LIMIT 1`
  );
  return anyQ.rows?.[0] || null;
}

// Возвращает Zoho-аккаунт самого пользователя.
// Приоритет: собственный токен в tg_users → users по email → admin fallback
async function getZohoUserForChat(db, chatId) {
  const tgUser = await getTgUser(db, chatId);
  // 1. Собственный Zoho-токен подключён прямо в боте
  if (tgUser?.zoho_refresh_token) return tgUser;
  // 2. Аккаунт в веб-приложении с тем же email
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

// ── Send task to assignee ────────────────────────────────
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

// ── /start ───────────────────────────────────────────────
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

  const [projectFilesResult, taskFilesResult] = await Promise.allSettled([
    fetchZohoProjectDocuments(db, zohoUser, task.zoho_project_id),
    fetchZohoTaskAttachments(db, zohoUser, task.zoho_project_id, task.zoho_task_id),
  ]);

  const projectFiles = projectFilesResult.status === "fulfilled" ? projectFilesResult.value : [];
  const taskFiles = taskFilesResult.status === "fulfilled" ? taskFilesResult.value : [];
  const files = [...taskFiles, ...projectFiles]
    .filter((file) => file.download_url)
    .sort((a, b) => String(b.uploaded_at || "").localeCompare(String(a.uploaded_at || "")))
    .slice(0, 20);

  if (!files.length) {
    const projectErr = projectFilesResult.status === "rejected" ? projectFilesResult.reason?.message : "";
    const taskErr = taskFilesResult.status === "rejected" ? taskFilesResult.reason?.message : "";
    const hint = projectErr || taskErr
      ? "\n\nIf files are missing, reconnect Zoho in the bot to refresh file permissions."
      : "";
    await cleanSend(chatId, `No downloadable Zoho files were found for this task.${hint}`);
    return;
  }

  const session = getChatSession(chatId);
  const fileMaps = { ...(session.fileMaps || {}), [taskId]: files };
  setChatSession(chatId, { fileMaps });

  const keyboard = {
    inline_keyboard: files.map((file, idx) => ([
      { text: `${file.source === "task" ? "[Task]" : "[Project]"} ${file.name}`, callback_data: `file:${taskId}:${idx}` },
    ])),
  };

  await cleanSend(
    chatId,
    `Task: ${task.zoho_task_name}\nProject: ${task.zoho_project_name}\n\nChoose a file to download:`,
    { reply_markup: keyboard }
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

async function handleStart(msg) {
  const chatId = msg.chat.id;
  const db = getDb();
  const existing = await getTgUser(db, chatId);
  if (existing) {
    return bot.sendMessage(chatId,
      `👋 С возвращением, <b>${existing.name}</b>!\n\nВыбери действие:`,
      MAIN_MENU
    );
  }
  const name = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") || "User";
  sessions.set(chatId, { state: "await_email", name });
  bot.sendMessage(chatId,
    `👋 Привет, <b>${name}</b>!\n\nВведи свой email (как в Zoho), чтобы я мог назначать тебе задачи:`,
    { parse_mode: "HTML" }
  );
}

// ── Профиль ──────────────────────────────────────────────
async function handleProfile(chatId) {
  const db = getDb();
  const user = await getTgUser(db, chatId);
  if (!user) return bot.sendMessage(chatId, "Ты ещё не зарегистрирован. Нажми /start");
  bot.sendMessage(chatId,
    `👤 <b>Профиль</b>\n\n` +
    `Имя: ${user.name}\n` +
    `Email: ${user.email}\n\n` +
    `Для смены email — напиши новый email сюда.`,
    { parse_mode: "HTML" }
  );
}

// ── Подключить Zoho ──────────────────────────────────────
async function handleConnectZoho(chatId) {
  const db = getDb();
  const tgUser = await getTgUser(db, chatId);
  if (!tgUser) {
    return bot.sendMessage(chatId, "Сначала зарегистрируйся — нажми /start");
  }
  try {
    const url = buildZohoAuthUrlForBot(chatId);
    const isConnected = Boolean(tgUser.zoho_refresh_token);
    bot.sendMessage(chatId,
      (isConnected
        ? `✅ Zoho уже подключён.\n\nЕсли хочешь переподключить аккаунт — нажми кнопку ниже.`
        : `🔗 <b>Подключи свой Zoho-аккаунт</b>\n\nПосле подключения задачи будут создаваться и закрываться от твоего имени.`) +
      `\n\n<a href="${url}">👉 Нажми сюда для авторизации в Zoho</a>`,
      { parse_mode: "HTML", disable_web_page_preview: true }
    );
  } catch (e) {
    bot.sendMessage(chatId, `❌ Ошибка: ${e.message}`);
  }
}

// ── Статистика ───────────────────────────────────────────
async function handleStats(chatId) {
  const db = getDb();
  const user = await getTgUser(db, chatId);
  if (!user) return bot.sendMessage(chatId, "Сначала зарегистрируйся — нажми /start");

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
    `📊 <b>Твоя статистика</b>\n\n` +
    `<b>Эта неделя:</b>\n` +
    `• Задач закрыто: ${s.week_tasks}\n` +
    `• Время залогировано: ${fmt(Number(s.week_seconds))}\n\n` +
    `<b>Этот месяц:</b>\n` +
    `• Задач закрыто: ${s.month_tasks}\n` +
    `• Время залогировано: ${fmt(Number(s.month_seconds))}\n\n` +
    `<b>За всё время:</b>\n` +
    `• Задач закрыто: ${s.all_tasks}\n` +
    `• Время залогировано: ${fmt(Number(s.all_seconds))}`,
    { parse_mode: "HTML" }
  );
}

// ── Помощь ───────────────────────────────────────────────
function handleHelp(chatId) {
  bot.sendMessage(chatId,
    `❓ <b>Как пользоваться ботом:</b>\n\n` +
    `➕ <b>Создать задачу</b> — выбери проект, введи название, выбери исполнителя. Задача появится в Zoho и отправится исполнителю в личку.\n\n` +
    `📁 <b>Проекты</b> — просмотр задач по проектам. Нажми на задачу, чтобы взять её себе.\n\n` +
    `▶️ <b>Старт / ⏸ Пауза</b> — управление таймером прямо в сообщении.\n\n` +
    `✅ <b>Закрыть задачу</b> — время улетает в Zoho, задача закрывается.`,
    { parse_mode: "HTML" }
  );
}

// ── /projects ────────────────────────────────────────────
async function handleProjects(chatId) {
  const db = getDb();
  const zohoUser = await getZohoUser(db);
  if (!zohoUser) return cleanSend(chatId, "❌ Zoho не подключён.");
  await cleanSend(chatId, "⏳ Загружаю проекты...");
  try {
    const projects = await fetchZohoProjects(db, zohoUser);
    if (!projects.length) return cleanSend(chatId, "Проектов не найдено.");
    sessions.set(chatId, { ...sessions.get(chatId), state: "search_project", projects, mode: "view" });
    await cleanSend(chatId,
      `🔍 Найдено проектов: <b>${projects.length}</b>\n\nВведи название (или часть) для поиска:`,
      { parse_mode: "HTML" }
    );
  } catch (e) {
    cleanSend(chatId, `❌ Ошибка: ${e.message}`);
  }
}

// ── Показать отфильтрованные проекты ─────────────────────
async function showFilteredProjects(chatId, projects, query, mode) {
  const filtered = query
    ? projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    : projects;

  if (!filtered.length) {
    return cleanSend(chatId,
      `❌ Проект "<b>${query}</b>" не найден.\nПопробуй другое название:`,
      { parse_mode: "HTML" }
    );
  }

  const prefix = mode === "newtask" ? "newtask_proj_" : "proj_";
  const keyboard = {
    inline_keyboard: [
      ...filtered.slice(0, 20).map((p) => ([
        { text: `📁 ${p.name}`, callback_data: `${prefix}${p.id}` },
      ])),
      [{ text: "🔍 Новый поиск", callback_data: `search_again_${mode}` }],
    ],
  };
  await cleanSend(chatId,
    filtered.length === projects.length
      ? `📁 Все проекты (${filtered.length}):`
      : `📁 Найдено: <b>${filtered.length}</b> из ${projects.length}:`,
    { parse_mode: "HTML", reply_markup: keyboard }
  );
}

// ── /newtask ─────────────────────────────────────────────
async function handleNewTask(chatId) {
  const db = getDb();
  const zohoUser = await getZohoUser(db);
  if (!zohoUser) return bot.sendMessage(chatId, "❌ Zoho не подключён.");
  await cleanSend(chatId, "⏳ Загружаю проекты...");
  try {
    const projects = await fetchZohoProjects(db, zohoUser);
    if (!projects.length) return cleanSend(chatId, "Проектов не найдено.");
    sessions.set(chatId, { state: "search_project", projects, mode: "newtask" });
    await cleanSend(chatId,
      `🔍 Найдено проектов: <b>${projects.length}</b>\n\nВведи название (или часть) для поиска:`,
      { parse_mode: "HTML" }
    );
  } catch (e) {
    cleanSend(chatId, `❌ Ошибка: ${e.message}`);
  }
}

// ── callback_query handler ───────────────────────────────
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
    const [, taskId, fileIndexRaw] = data.split(":");
    const fileIndex = Number(fileIndexRaw);
    if (!taskId || Number.isNaN(fileIndex)) return;
    await sendTaskFile(chatId, taskId, fileIndex);
    return;
  }

  // ── Выбор проекта (просмотр задач) ──
  if (data.startsWith("proj_")) {
    const projectId = data.slice(5);
    const zohoUser = await getZohoUser(db);
    await cleanSend(chatId, "⏳ Загружаю задачи...");
    try {
      const tasks = await fetchZohoTasks(db, zohoUser, projectId);
      const projects = await fetchZohoProjects(db, zohoUser);
      const project = projects.find((p) => p.id === projectId);
      if (!tasks.length) return cleanSend(chatId, "Задач в проекте нет.");
      const keyboard = {
        inline_keyboard: tasks.map((t, idx) => ([
          { text: `📌 ${t.name}`, callback_data: `task_${projectId}_idx${idx}` },
        ])),
      };
      sessions.set(chatId, { state: "task_list", projectId, project, tasks });
      await cleanSend(chatId, `📁 <b>${project?.name}</b>\nВыбери задачу:`, {
        parse_mode: "HTML", reply_markup: keyboard,
      });
    } catch (e) {
      cleanSend(chatId, `❌ Ошибка: ${e.message}`);
    }
    return;
  }

  // ── Выбор задачи → назначить на себя ──
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
      zoho_task_name: task?.name || "Задача",
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

  // ── ▶️ Старт таймера ──
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

  // ── ⏸ Пауза ──
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

  // ── ✅ Закрыть ──
  if (data.startsWith("close_")) {
    const taskId = data.slice(6);
    const task = await getTgTask(db, taskId);
    if (!task || task.status === "done") return;

    const elapsed = getElapsed(task);
    await db.query(
      `UPDATE tg_tasks SET status='done', timer_started_at=NULL, elapsed_seconds=$1 WHERE id=$2`,
      [elapsed, taskId]
    );

    bot.sendMessage(chatId, `⏳ Закрываю задачу в Zoho и логирую время <b>${fmt(elapsed)}</b>...`, { parse_mode: "HTML" });

    try {
      const db2 = getDb();
      const zohoUser = await getZohoUserForChat(db2, chatId);

      // Логируем время от имени пользователя
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
            `Работа над задачей (Telegram бот)`,
            ownerId
          );
          timeLogged = true;
        } catch (timeErr) {
          timeErrMsg = timeErr.message;
          console.error("[Bot] Time log error:", timeErr.message);
        }
      }

      // Закрываем задачу — отдельно, всегда
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
        bot.sendMessage(chatId, `✅ Готово! Время <b>${fmt(elapsed)}</b> залогировано в Zoho. Задача закрыта.`, { parse_mode: "HTML" });
      } else if (taskClosed && elapsed <= 60) {
        bot.sendMessage(chatId, `✅ Задача закрыта в Zoho.\nВремя не засчитано — меньше минуты.`);
      } else if (taskClosed) {
        bot.sendMessage(chatId, `✅ Задача закрыта в Zoho.\n⚠️ Время не удалось залогировать (${fmt(elapsed)}).\n\n<code>${timeErrMsg}</code>`, { parse_mode: "HTML" });
      } else {
        bot.sendMessage(chatId, `⚠️ Не удалось закрыть задачу в Zoho.\n\n<code>${closeErrMsg}</code>`, { parse_mode: "HTML" });
      }
    } catch (e) {
      bot.sendMessage(chatId, `⚠️ Ошибка Zoho: ${e.message}`);
    }

    try {
      const updated = await getTgTask(db, taskId);
      await updateTaskMessage(db, updated);
    } catch (_) {}
    return;
  }

  // ── Новый поиск ──
  if (data.startsWith("search_again_")) {
    const mode = data.slice(13);
    const session = sessions.get(chatId) || {};
    sessions.set(chatId, { ...session, state: "search_project", mode });
    await cleanSend(chatId, "🔍 Введи название проекта для поиска:", { parse_mode: "HTML" });
    return;
  }

  // ── Выбор проекта при создании новой задачи ──
  if (data.startsWith("newtask_proj_")) {
    const projectId = data.slice(13);
    const session = sessions.get(chatId) || {};
    const project = session.projects?.find((p) => p.id === projectId);
    sessions.set(chatId, { state: "newtask_enter_title", projectId, project });
    await cleanSend(chatId, `📁 Проект: <b>${project?.name}</b>\n\nВведи название задачи:`, { parse_mode: "HTML" });
    return;
  }

  // ── Выбор исполнителя при создании новой задачи ──
  if (data.startsWith("newtask_assign_")) {
    const idx = parseInt(data.slice(15), 10);
    const session = sessions.get(chatId) || {};
    const assignee = session.users?.[idx];

    // Найти chat_id исполнителя по email
    const db2 = getDb();
    let assigneeChatId = String(chatId); // fallback — создателю
    if (assignee?.email) {
      const tgQ = await db2.query(`SELECT chat_id FROM tg_users WHERE LOWER(email)=LOWER($1)`, [assignee.email]);
      if (tgQ.rows?.[0]) assigneeChatId = tgQ.rows[0].chat_id;
    }

    const zohoUser = await getZohoUserForChat(db2, chatId);
    await cleanSend(chatId, "⏳ Создаю задачу в Zoho...");
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
      bot.sendMessage(chatId, `✅ Задача создана в Zoho и отправлена исполнителю.`);

      // Отправить исполнителю (если не сам себе)
      await sendTaskToAssignee(db2, assigneeChatId, taskRow);
      if (assigneeChatId !== String(chatId)) {
        bot.sendMessage(chatId,
          `📨 Задача отправлена: <b>${assignee?.name || assignee?.email}</b>`,
          { parse_mode: "HTML" }
        );
      }
    } catch (e) {
      console.error("[Bot] Task create error:", e);
      bot.sendMessage(chatId, `❌ Ошибка создания задачи: ${e.message}\n<code>${e.cause?.message || e.code || ""}</code>`, { parse_mode: "HTML" });
    }
    return;
  }
}

// ── Text message handler ─────────────────────────────────
async function handleText(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  const session = sessions.get(chatId);
  const db = getDb();

  // ── Кнопки главного меню ──
  if (text === "➕ Создать задачу")  return handleNewTask(chatId);
  if (text === "📁 Проекты")        return handleProjects(chatId);
  if (text === "👤 Мой профиль")    return handleProfile(chatId);
  if (text === "🔗 Подключить Zoho") return handleConnectZoho(chatId);
  if (text === "📊 Статистика")     return handleStats(chatId);
  if (text === "❓ Помощь")         return handleHelp(chatId);

  // ── Поиск проекта ──
  if (session?.state === "search_project") {
    await showFilteredProjects(chatId, session.projects, text, session.mode);
    return;
  }

  // ── Регистрация email ──
  if (session?.state === "await_email") {
    const email = text.toLowerCase();
    if (!email.includes("@")) return bot.sendMessage(chatId, "Введи корректный email:");
    await saveTgUser(db, chatId, session.name, email);
    sessions.delete(chatId);
    return bot.sendMessage(chatId,
      `✅ Готово! Ты зарегистрирован как <b>${session.name}</b> (${email}).\n\nВыбери действие:`,
      MAIN_MENU
    );
  }

  // ── Смена email из профиля ──
  if (!session && text.includes("@") && text.includes(".")) {
    const user = await getTgUser(db, chatId);
    if (user) {
      await saveTgUser(db, chatId, user.name, text.toLowerCase());
      return bot.sendMessage(chatId, `✅ Email обновлён: ${text.toLowerCase()}`);
    }
  }

  // ── Ввод названия новой задачи ──
  if (session?.state === "newtask_enter_title") {
    sessions.set(chatId, { ...session, state: "newtask_select_assignee", title: text });
    await cleanSend(chatId, "⏳ Загружаю участников проекта...");
    try {
      const zohoUser = await getZohoUser(db);
      const allUsers = await fetchZohoProjectUsers(db, zohoUser, session.projectId);
      const tgUser = await getTgUser(db, chatId);

      // Показываем только себя (по email из регистрации)
      const users = tgUser?.email
        ? allUsers.filter((u) => u.email.toLowerCase() === tgUser.email.toLowerCase())
        : allUsers;

      if (!users.length) return cleanSend(chatId, "❌ Твой email не найден в участниках этого проекта. Попроси администратора добавить тебя в Zoho.");

      sessions.set(chatId, { ...sessions.get(chatId), users });
      const keyboard = {
        inline_keyboard: users.map((u, idx) => ([
          { text: `👤 ${u.name} (${u.email})`, callback_data: `newtask_assign_${idx}` },
        ])),
      };
      await cleanSend(chatId, "👤 Подтверди исполнителя:", { reply_markup: keyboard });
    } catch (e) {
      cleanSend(chatId, `❌ Ошибка: ${e.message}`);
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

// ── Init bot ─────────────────────────────────────────────
export function startBot(app) {
  if (!TOKEN) {
    console.warn("[Bot] TELEGRAM_BOT_TOKEN not set — bot disabled");
    return;
  }

  const appUrl = String(process.env.APP_BASE_URL || "").replace(/\/+$/, "");

  if (appUrl) {
    // ── Webhook mode (production) ──
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
    // ── Polling mode (local dev) ──
    bot = new TelegramBot(TOKEN, { polling: true });
    registerHandlers();
    bot.on("polling_error", (e) => console.error("[Bot] polling error:", e.message));
    console.log("[Bot] Polling mode");
  }

  process.on("SIGTERM", () => {
    console.log("[Bot] SIGTERM — shutting down");
    (bot.isPolling() ? bot.stopPolling() : Promise.resolve()).then(() => process.exit(0));
  });

  const GROUP_ID = process.env.TELEGRAM_CHAT_ID;

  // ── Уведомление об обновлении ──
  if (GROUP_ID) {
    const appUrl = String(process.env.APP_BASE_URL || "").replace(/\/+$/, "");
    bot.sendMessage(GROUP_ID,
      `🔄 <b>Engineer Tool обновлён!</b>\n\n` +
      `🆕 <b>Что нового:</b>\n` +
      `• 🌆 Напоминание о конце рабочего дня теперь приходит в <b>19:00</b> по Дубаю\n` +
      `• 📅 Вечернее напоминание теперь работает только <b>по будням</b>\n` +
      `• 🧹 Удалённые сообщения в общем и личном чате теперь исчезают полностью, без текста <code>[message deleted]</code>\n\n` +
      (appUrl ? `🔗 <a href="${appUrl}">Открыть Engineer Tool</a>` : `✅ Обновление применено`),
      { parse_mode: "HTML" }
    );
  }

  const remindedTasks = new Set(); // задачи, по которым уже отправили напоминание о долгом таймере

  const motivations = [
    "Половина дня позади — ты уже молодец! 💪",
    "Самое время сделать перерыв и вернуться с новыми силами ☕",
    "Ты справляешься отлично. Осталось совсем чуть-чуть! 🎯",
    "Не забывай пить воду и двигаться — продуктивность скажет спасибо 💧",
    "Каждая закрытая задача — это маленькая победа 🏆",
    "Ты ближе к концу дня, чем к его началу. Держись! 🚀",
    "Лучший способ сделать много — делать по одному 🧩",
    "Сегодня хороший день, чтобы закрыть пару задач 😎",
  ];

  const mondayJokes = [
    "Понедельник — это когда будильник звонит в 7 утра, а организм шлёт его куда подальше 📵",
    "Говорят, понедельник — день тяжёлый. Но мы же не ищем лёгких путей! 💪",
    "Понедельник: 5 дней до выходных. Начнём отсчёт! 🚀",
    "Хорошая новость — сегодня понедельник, а значит следующий понедельник ещё далеко 😅",
    "Понедельник — это маленький Новый год. Новая неделя, новые задачи, новые победы! 🎯",
    "Наука доказала: понедельник наступает независимо от того, готов ты к нему или нет 🔬",
    "Понедельник не такой страшный, если встретить его с задачами в Zoho и кофе в руке ☕",
    "Все великие дела начинались в понедельник. Ну или во вторник, когда понедельник уже прошёл 😂",
  ];

  // ── Утреннее напоминание: 10:00 Дубай (UTC+4 = 06:00 UTC), пн–пт ──
  cron.schedule("0 6 * * 1-5", () => {
    if (!GROUP_ID) return;
    const day = new Date().getDay(); // 1 = понедельник
    if (day === 1) {
      const joke = mondayJokes[Math.floor(Math.random() * mondayJokes.length)];
      bot.sendMessage(GROUP_ID,
        `🌅 <b>С понедельником, команда!</b>\n\n` +
        `${joke}\n\n` +
        `Новая неделя — новые задачи. Открывай бот, создавай задачи и запускай таймер! 💼\n` +
        `📲 Напишите мне в личку → <b>➕ Создать задачу</b>`,
        { parse_mode: "HTML" }
      );
    } else {
      bot.sendMessage(GROUP_ID,
        `🌅 <b>Доброе утро, команда!</b>\n\n` +
        `Не забудьте открыть задачи на сегодня — запустите таймер, как только начнёте работу.\n\n` +
        `📲 Напишите мне в личку → <b>➕ Создать задачу</b>`,
        { parse_mode: "HTML" }
      );
    }
    console.log("[Bot] Sent morning reminder");
  });

  // ── Вечернее напоминание: 19:00 Дубай (UTC+4 = 15:00 UTC), пн–пт ──
  cron.schedule("0 15 * * 1-5", () => {
    if (!GROUP_ID) return;
    bot.sendMessage(GROUP_ID,
      `🌆 <b>Конец рабочего дня!</b>\n\n` +
      `Не забудьте закрыть все активные задачи — нажмите кнопку <b>✅ Закрыть задачу</b> в личке бота, чтобы время ушло в Zoho.\n\n` +
      `Хорошего вечера! 👋`,
      { parse_mode: "HTML" }
    );
    console.log("[Bot] Sent evening reminder");
  });

  // ── Мотивашка в обед: 13:00 Дубай (UTC+4 = 09:00 UTC), пн–пт ──
  cron.schedule("0 9 * * 1-5", () => {
    if (!GROUP_ID) return;
    const msg = motivations[Math.floor(Math.random() * motivations.length)];
    bot.sendMessage(GROUP_ID, `💬 ${msg}`, { parse_mode: "HTML" });
  });

  // ── Проверка долгих таймеров: каждые 30 минут ──
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
          `⏰ <b>Таймер работает уже ${fmt(elapsed)}!</b>\n\n` +
          `Задача «${task.zoho_task_name}» всё ещё активна.\n` +
          `Не забудь поставить на паузу или закрыть.`,
          { parse_mode: "HTML" }
        ).catch(() => {});
      }
    } catch (e) {
      console.error("[Bot] Long timer check error:", e.message);
    }
  });

  // ── Пятничный отчёт: 18:00 Дубай (UTC+4 = 14:00 UTC) ──
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

      const medals = ["🥇", "🥈", "🥉"];
      const lines = q.rows.map((r, i) =>
        `${medals[i] || "▪️"} <b>${r.name || "Неизвестный"}</b> — ${fmt(Number(r.seconds))} (${r.tasks} задач)`
      ).join("\n");

      const winner = q.rows[0];
      bot.sendMessage(GROUP_ID,
        `🏆 <b>Итоги недели!</b>\n\n` +
        `${lines}\n\n` +
        `🎉 Работяга недели: <b>${winner.name || "Неизвестный"}</b> — ${fmt(Number(winner.seconds))} залогировано!\n\n` +
        `Отличная работа, команда! Хороших выходных 🎉`,
        { parse_mode: "HTML" }
      );
    } catch (e) {
      console.error("[Bot] Weekly report error:", e.message);
    }
  });
}
