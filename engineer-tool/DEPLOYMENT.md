## Single-service deployment (server serves the built frontend)

This repo can be deployed as **one web service**: build the client, then run the server which serves `client/dist`.

**Build:** `npm run install:all && npm run build`

**Start:** `npm start`

---

# Deploy (Netlify + Render)

## 1) Backend → Render (Web Service)

**Root Directory:** `server`  
**Build Command:** `npm install`  
**Start Command:** `npm start`  

### Environment variables (Render → Environment)
- `DATABASE_URL` — Postgres connection string (лучше Neon/Supabase или Render Postgres)
- `DB_SSL` — `true` для Neon/Supabase/хостингов (обычно нужен SSL)
- `JWT_SECRET` — секрет для JWT
- `ADMIN_EMAIL` — email админа
- `ADMIN_PASSWORD` — пароль админа

Проверка: `https://<render-url>/health` должно вернуть `{ "ok": true }`.

> Примечание: на бесплатных планах SQLite почти всегда будет «эфемерной» (может потеряться после деплоя/перезапуска). Поэтому здесь сразу PostgreSQL.

### Бесплатная БД (рекомендации)
- Neon (Free)
- Supabase (Free)

Берёшь `DATABASE_URL` из Neon/Supabase и вставляешь в Render.

---

## 2) Frontend → Netlify

В проекте уже есть `netlify.toml`, поэтому Netlify сам подхватит:
- base: `client`
- build: `npm run build`
- publish: `client/dist`

### Environment variables (Netlify → Site settings → Environment variables)
- `VITE_API_BASE` = `https://<render-url>`

---

## 3) Если видишь CORS ошибку
Backend уже настроен на `cors({ origin: true, credentials: true })`.
