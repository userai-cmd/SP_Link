import { Router } from "express";
import { query } from "../db/pool.js";
import { authMiddleware, adminOnly } from "../auth.js";

export const channelsRouter = Router();

channelsRouter.use(authMiddleware);

channelsRouter.get("/", async (_req, res) => {
  const result = await query(
    "SELECT id, name, description FROM channels ORDER BY id",
  );
  res.json({ channels: result.rows });
});

channelsRouter.post("/", adminOnly, async (req, res) => {
  const { name, description } = req.body || {};
  const clean = String(name || "").trim().toLowerCase().replace(/^#/, "");
  if (!clean) return res.status(400).json({ error: "Вкажіть назву каналу" });

  try {
    const result = await query(
      "INSERT INTO channels (name, description) VALUES ($1, $2) RETURNING id, name, description",
      [clean, String(description || "").trim()],
    );
    res.status(201).json({ channel: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Канал з такою назвою вже існує" });
    }
    throw err;
  }
});
