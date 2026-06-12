# SP_Link — SAT-Postex Connect

Легкий корпоративний месенджер (міні-Slack) із вбудованим таск-менеджером для співробітників SAT і Postex. Працює як PWA — встановлюється на iOS та Android прямо з браузера.

## Можливості

- **Чат у реальному часі** — канали (#загальний, #операції, #спірні-питання), WebSocket, завантаження файлів (накладні, фото).
- **Задачі з контексту** — будь-яке повідомлення перетворюється на задачу одним кліком; канбан Todo / In Progress / Done із drag-and-drop.
- **Адмін-панель** — створення користувачів (SAT / POSTEX), редагування, скидання паролів, нові канали.
- **PWA** — manifest, service worker (офлайн-запуск, кеш статики), Add to Home Screen.

## Стек

- Node.js + Express + ws (один процес: API + WebSocket + статика)
- PostgreSQL (pg)
- Vanilla JS SPA, mobile-first
- JWT-авторизація (bcryptjs + jsonwebtoken)

## Запуск локально

```bash
npm install
createdb sp_link            # потрібен запущений PostgreSQL
cp .env.example .env        # за потреби відредагуй
npm start                   # міграція і seed виконуються автоматично
```

Відкрий http://localhost:3000. Перший вхід: `admin@sat.ua` / `admin12345` (зміни через ADMIN_EMAIL / ADMIN_PASSWORD).

## Деплой на Railway

1. Створи проект із цього репозиторію + додай плагін PostgreSQL.
2. Railway сам надасть `DATABASE_URL` і `PORT`.
3. Додай змінні: `JWT_SECRET` (довгий випадковий рядок), за бажанням `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
4. Start command: `npm start`. Міграція і seed виконуються автоматично при старті.

> Завантажені файли зберігаються на диску (`uploads/`). На Railway підключи Volume до цієї папки, інакше файли зникнуть після redeploy.

## Структура

```
server/
  index.js          # Express + WebSocket + статика
  auth.js           # JWT, middleware
  ws.js             # WebSocket hub + broadcast
  db/
    pool.js         # підключення PostgreSQL
    migrate.js      # схема БД
    seed.js         # дефолтні канали + admin
  routes/
    auth.js users.js channels.js messages.js tasks.js upload.js
public/
  index.html manifest.json sw.js
  css/app.css       # SAT-тема (dark/soft)
  js/app.js         # SPA
  icons/            # PWA-іконки
```
