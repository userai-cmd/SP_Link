import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

import { pool } from "./db/pool.js";
import { seed } from "./db/seed.js";
import { setupWebSocket } from "./ws.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { channelsRouter } from "./routes/channels.js";
import { messagesRouter } from "./routes/messages.js";
import { tasksRouter } from "./routes/tasks.js";
import { uploadRouter, UPLOAD_DIR } from "./routes/upload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PORT = process.env.PORT || 3000;

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/channels", channelsRouter);
app.use("/api/messages", messagesRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/upload", uploadRouter);

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: true });
  } catch {
    res.status(503).json({ ok: false, db: false });
  }
});

app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "30d" }));
app.use(express.static(PUBLIC_DIR));

// SPA fallback: everything that is not API/static goes to index.html.
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api")) return next();
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// Centralized error handler.
app.use((err, _req, res, _next) => {
  console.error(err);
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "Файл завеликий (макс. 15 МБ)" });
  }
  res.status(500).json({ error: "Внутрішня помилка сервера" });
});

const server = http.createServer(app);
setupWebSocket(server);

// Auto-migrate and seed on boot so Railway deploys are zero-touch.
seed()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`SP_Link listening on :${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Startup failed:", err);
    process.exit(1);
  });
