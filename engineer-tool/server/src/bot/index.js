// server/src/bot/index.js — Zoho Task Bot
import TelegramBot from "node-telegram-bot-api";
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

// ── helpers ──────────────────────────────────────────────
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
  const q = await db.query(
    `SELECT * FROM users WHERE zoho_refresh_token IS NOT NULL ORDER BY created_at LIMIT 1`
  );
  return q.rows?.[0] || null;
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
      `👋 С возвращением, <b>${existing.name}</b>!\n\n` +
      `/projects — список проектов\n/newtask — создать задачу`,
      { parse_mode: "HTML" }
    );
  }
  const name = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") || "User";
  sessions.set(chatId, { state: "await_email", name });
  bot.sendMessage(chatId,
    `👋 Привет, <b>${name}</b>!\n\nВведи свой email (как в Zoho), чтобы я мог назначать тебе задачи:`,
    { parse_mode: "HTML" }
  );
}

// ── /projects ────────────────────────────────────────────
async function handleProjects(chatId) {
  const db = getDb();
  const zohoUser = await getZohoUser(db);
  if (!zohoUser) {
    return bot.sendMessage(chatId, "❌ Zoho не подключён. Подключи аккаунт в Engineer Tool.");
  }
  bot.sendMessage(chatId, "⏳ Загружаю проекты...");
  try {
    const projects = await fetchZohoProjects(db, zohoUser);
    if (!projects.length) return bot.sendMessage(chatId, "Проектов не найдено.");
    const keyboard = {
      inline_keyboard: projects.map((p) => ([
        { text: `📁 ${p.name}`, callback_data: `proj_${p.id}` },
      ])),
    };
    bot.sendMessage(chatId, "Выбери проект:", { reply_markup: keyboard });
  } catch (e) {
    bot.sendMessage(chatId, `❌ Ошибка: ${e.message}`);
  }
}

// ── /newtask ─────────────────────────────────────────────
async function handleNewTask(chatId) {
  const db = getDb();
  const zohoUser = await getZohoUser(db);
  if (!zohoUser) return bot.sendMessage(chatId, "❌ Zoho не подключён.");
  bot.sendMessage(chatId, "⏳ Загружаю проекты...");
  try {
    const projects = await fetchZohoProjects(db, zohoUser);
    if (!projects.length) return bot.sendMessage(chatId, "Проектов не найдено.");
    sessions.set(chatId, { state: "newtask_select_project", projects });
    const keyboard = {
      inline_keyboard: projects.map((p) => ([
        { text: `📁 ${p.name}`, callback_data: `newtask_proj_${p.id}` },
      ])),
    };
    bot.sendMessage(chatId, "📁 Выбери проект для новой задачи:", { reply_markup: keyboard });
  } catch (e) {
    bot.sendMessage(chatId, `❌ Ошибка: ${e.message}`);
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
    bot.sendMessage(chatId, "⏳ Загружаю задачи...");
    try {
      const tasks = await fetchZohoTasks(db, zohoUser, projectId);
      const projects = await fetchZohoProjects(db, zohoUser);
      const project = projects.find((p) => p.id === projectId);
      if (!tasks.length) return bot.sendMessage(chatId, "Задач в проекте нет.");
      const keyboard = {
        inline_keyboard: tasks.map((t) => ([
          { text: `📌 ${t.name}`, callback_data: `task_${projectId}_${t.id}` },
        ])),
      };
      sessions.set(chatId, { state: "task_list", projectId, project, tasks });
      bot.sendMessage(chatId, `📁 <b>${project?.name}</b>\nВыбери задачу:`, {
        parse_mode: "HTML", reply_markup: keyboard,
      });
    } catch (e) {
      bot.sendMessage(chatId, `❌ Ошибка: ${e.message}`);
    }
    return;
  }

  // ── Выбор задачи → назначить на себя ──
  if (data.startsWith("task_")) {
    const [, projectId, taskId] = data.split("_");
    const session = sessions.get(chatId) || {};
    const task = session.tasks?.find((t) => t.id === taskId);
    const project = session.project;

    const taskRow = {
      id: uid(),
      zoho_project_id: projectId,
      zoho_project_name: project?.name || "",
      zoho_task_id: taskId,
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
      const zohoUser = await getZohoUser(db2);
      const tgUser = await getTgUser(db2, chatId);

      await createZohoTimeLog(
        db2, zohoUser,
        task.zoho_project_id, task.zoho_task_id,
        elapsed,
        `Работа над задачей (Telegram бот)`,
        tgUser?.zoho_user_id || ""
      );
      await completeZohoTask(db2, zohoUser, task.zoho_project_id, task.zoho_task_id);
      bot.sendMessage(chatId, `✅ Готово! Время <b>${fmt(elapsed)}</b> залогировано в Zoho. Задача закрыта.`, { parse_mode: "HTML" });
    } catch (e) {
      bot.sendMessage(chatId, `⚠️ Задача закрыта локально, но ошибка Zoho: ${e.message}`);
    }

    const updated = await getTgTask(db, taskId);
    await updateTaskMessage(db, updated);
    return;
  }

  // ── Выбор проекта при создании новой задачи ──
  if (data.startsWith("newtask_proj_")) {
    const projectId = data.slice(13);
    const session = sessions.get(chatId) || {};
    const project = session.projects?.find((p) => p.id === projectId);
    sessions.set(chatId, { state: "newtask_enter_title", projectId, project });
    bot.sendMessage(chatId, `📁 Проект: <b>${project?.name}</b>\n\nВведи название задачи:`, { parse_mode: "HTML" });
    return;
  }

  // ── Выбор исполнителя при создании новой задачи ──
  if (data.startsWith("newtask_assign_")) {
    const parts = data.slice(15).split("_");
    const zohoUserId = parts[0];
    const session = sessions.get(chatId) || {};
    const assignee = session.users?.find((u) => u.id === zohoUserId || u.portal_id === zohoUserId);

    // Найти chat_id исполнителя по email
    const db2 = getDb();
    let assigneeChatId = String(chatId); // fallback — создателю
    if (assignee?.email) {
      const tgQ = await db2.query(`SELECT chat_id FROM tg_users WHERE LOWER(email)=LOWER($1)`, [assignee.email]);
      if (tgQ.rows?.[0]) assigneeChatId = tgQ.rows[0].chat_id;
    }

    const zohoUser = await getZohoUser(db2);
    bot.sendMessage(chatId, "⏳ Создаю задачу в Zoho...");
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

  // Регистрация email
  if (session?.state === "await_email") {
    const email = text.toLowerCase();
    if (!email.includes("@")) return bot.sendMessage(chatId, "Введи корректный email:");
    await saveTgUser(db, chatId, session.name, email);
    sessions.delete(chatId);
    return bot.sendMessage(chatId,
      `✅ Готово! Ты зарегистрирован как <b>${session.name}</b> (${email}).\n\n` +
      `/projects — список проектов\n/newtask — создать задачу`,
      { parse_mode: "HTML" }
    );
  }

  // Ввод названия новой задачи
  if (session?.state === "newtask_enter_title") {
    sessions.set(chatId, { ...session, state: "newtask_select_assignee", title: text });
    bot.sendMessage(chatId, "⏳ Загружаю участников проекта...");
    try {
      const zohoUser = await getZohoUser(db);
      const users = await fetchZohoProjectUsers(db, zohoUser, session.projectId);
      sessions.set(chatId, { ...sessions.get(chatId), users });
      const keyboard = {
        inline_keyboard: users.map((u) => ([
          { text: `👤 ${u.name} (${u.email})`, callback_data: `newtask_assign_${u.id}` },
        ])),
      };
      bot.sendMessage(chatId, "Выбери исполнителя:", { reply_markup: keyboard });
    } catch (e) {
      bot.sendMessage(chatId, `❌ Ошибка: ${e.message}`);
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
}
