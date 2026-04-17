// server/src/bot/index.js — Zoho Task Bot
import TelegramBot from "node-telegram-bot-api";
import cron from "node-cron";
import { getDb } from "../db.js";
import {
  fetchZohoProjects,
  fetchZohoTasks,
  fetchZohoProjectUsers,
  createZohoTask,
  completeZohoTask,
  createZohoTimeLog,
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
      [{ text: "👤 Мой профиль"   }, { text: "❓ Помощь"  }],
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

// Возвращает Zoho-аккаунт самого пользователя (по email из tg_users),
// если у него есть подключённый Zoho — иначе fallback на admin
async function getZohoUserForChat(db, chatId) {
  const tgUser = await getTgUser(db, chatId);
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
      reply_markup: taskKeyboard(task.id, task.status),
    });
  } catch (_) {}
}

// ── Send task to assignee ────────────────────────────────
async function sendTaskToAssignee(db, assigneeChatId, taskRow) {
  const elapsed = getElapsed(taskRow);
  const msg = await bot.sendMessage(assigneeChatId, taskCard(taskRow, elapsed), {
    parse_mode: "HTML",
    reply_markup: taskKeyboard(taskRow.id, taskRow.status),
  });
  await db.query(`UPDATE tg_tasks SET tg_message_id=$1 WHERE id=$2`, [
    String(msg.message_id), taskRow.id,
  ]);
}

// ── /start ───────────────────────────────────────────────
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

      // Логируем время — без owner (от имени токена)
      let timeLogged = false;
      if (elapsed > 60) {
        try {
          await createZohoTimeLog(
            db2, zohoUser,
            task.zoho_project_id, task.zoho_task_id,
            elapsed,
            `Работа над задачей (Telegram бот)`,
            "" // без owner — логируем от имени admin-токена
          );
          timeLogged = true;
        } catch (timeErr) {
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
      } else if (taskClosed) {
        bot.sendMessage(chatId, `✅ Задача закрыта в Zoho.\n⚠️ Время не удалось залогировать (${fmt(elapsed)}).`, { parse_mode: "HTML" });
      } else {
        bot.sendMessage(chatId, `⚠️ Не удалось закрыть задачу в Zoho.\n\n<code>${closeErrMsg}</code>`, { parse_mode: "HTML" });
      }
    } catch (e) {
      bot.sendMessage(chatId, `⚠️ Ошибка Zoho: ${e.message}`);
    }

    const updated = await getTgTask(db, taskId);
    await updateTaskMessage(db, updated);
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
      bot.sendMessage(chatId, `❌ Ошибка создания задачи: ${e.message}`);
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
  if (text === "➕ Создать задачу") return handleNewTask(chatId);
  if (text === "📁 Проекты")       return handleProjects(chatId);
  if (text === "👤 Мой профиль")   return handleProfile(chatId);
  if (text === "❓ Помощь")        return handleHelp(chatId);

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

// ── Init bot ─────────────────────────────────────────────
export function startBot() {
  if (!TOKEN) {
    console.warn("[Bot] TELEGRAM_BOT_TOKEN not set — bot disabled");
    return;
  }

  bot = new TelegramBot(TOKEN, { polling: true });
  console.log("[Bot] Started polling");

  bot.onText(/\/start/, handleStart);
  bot.onText(/\/projects/, (msg) => handleProjects(msg.chat.id));
  bot.onText(/\/newtask/, (msg) => handleNewTask(msg.chat.id));

  bot.on("callback_query", handleCallback);
  bot.on("message", (msg) => {
    if (msg.text && !msg.text.startsWith("/")) handleText(msg);
  });

  bot.on("polling_error", (e) => console.error("[Bot] polling error:", e.message));

  const GROUP_ID = process.env.TELEGRAM_CHAT_ID;

  // ── Уведомление об обновлении ──
  if (GROUP_ID) {
    bot.sendMessage(GROUP_ID,
      `🔄 <b>Бот обновлён</b>\n\n` +
      `📦 <b>Что изменилось:</b>\n` +
      `• Задачи из раздела «Проекты» теперь назначаются на вас, а не на администратора — вы можете закрывать их самостоятельно\n\n` +
      `🐛 <b>Исправлено:</b>\n` +
      `• Ошибка назначения задач на чужой аккаунт при открытии через «📁 Проекты»`,
      { parse_mode: "HTML" }
    );
  }

  // ── Утреннее напоминание: 10:00 Дубай (UTC+4 = 06:00 UTC) ──
  cron.schedule("0 6 * * *", () => {
    if (!GROUP_ID) return;
    bot.sendMessage(GROUP_ID,
      `🌅 <b>Доброе утро, команда!</b>\n\n` +
      `Не забудьте открыть задачи на сегодня в боте — запустите таймер, как только начнёте работу.\n\n` +
      `📲 Напишите мне в личку и нажмите кнопку <b>➕ Создать задачу</b>.`,
      { parse_mode: "HTML" }
    );
    console.log("[Bot] Sent morning reminder");
  });

  // ── Вечернее напоминание: 18:00 Дубай (UTC+4 = 14:00 UTC) ──
  cron.schedule("0 14 * * *", () => {
    if (!GROUP_ID) return;
    bot.sendMessage(GROUP_ID,
      `🌆 <b>Конец рабочего дня!</b>\n\n` +
      `Не забудьте закрыть все активные задачи — нажмите кнопку <b>✅ Закрыть задачу</b> в личке бота, чтобы время ушло в Zoho.\n\n` +
      `Хорошего вечера! 👋`,
      { parse_mode: "HTML" }
    );
    console.log("[Bot] Sent evening reminder");
  });
}
