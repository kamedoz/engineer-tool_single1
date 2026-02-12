# Engineer Tool (MVP)

Простой MVP по твоей концепции:
- Регистрация / логин инженеров
- Слева — список пользователей + простой чат 1:1 (без вебсокетов, через REST и периодический опрос)
- Справа — создание заявки (quote): имя/фамилия инженера, объект, дата выезда
- Категории: системные + пользовательские (можно добавлять свои)
- Типовые проблемы по категориям, каждая проблема содержит шаги
- Можно создавать свои проблемы и шаги
- Просмотр созданных заявок

Стек:
- **Backend**: Node.js + Express + SQLite (better-sqlite3) + JWT
- **Frontend**: React + Vite

## Быстрый старт

### 1) Backend
```bash
cd server
npm i
cp .env.example .env
npm run dev
```
Backend стартует на `http://localhost:4000`

### 2) Frontend
```bash
cd client
npm i
npm run dev
```
Открой `http://localhost:5173`

## Данные по умолчанию
При первом запуске база заполняется демо-данными:
- Категории: KNX, Home Assistant, CNC
- Несколько типовых проблем со шагами

## Продакшен (быстро)
- Backend: `npm start`
- Frontend: `npm run build` и раздать `dist/` любым статик-сервером (Nginx/Netlify/Vercel).

## Примечания
- Пароли хэшируются (bcrypt).
- JWT хранится в localStorage (MVP-решение).
- Чат — MVP (polling раз в 2 сек). Можно заменить на WebSocket позже.


## Роли и доступ
Сейчас поддерживаются роли `engineer | admin`.

- `admin` видит все заявки
- `engineer` видит только заявки, которые **создал** или которые **назначены на него**

> Примечание: расширенный CRUD (редактирование/удаление заявок), PDF-экспорт и audit-log — можно добавить следующим шагом.

# Deploy (Netlify + Render)

## 1) Backend → Render (Web Service)

**Root Directory:** `server`  
**Build Command:** `npm install`  
**Start Command:** `npm start`  

### Environment variables (Render → Environment)
- `ADMIN_EMAIL` — email админа
- `ADMIN_PASSWORD` — пароль админа

Проверка: `https://<render-url>/health` должно вернуть `{ "ok": true }`.

> Примечание: база SQLite (`server/data.sqlite`) на бесплатных планах может быть временной. Для продакшена лучше PostgreSQL.

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

