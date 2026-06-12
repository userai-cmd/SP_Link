import { Router } from "express";
import { query } from "../db/pool.js";
import { authMiddleware } from "../auth.js";
import { broadcast } from "../ws.js";

export const messagesRouter = Router();

messagesRouter.use(authMiddleware);

const MESSAGE_SELECT = `
  SELECT m.id, m.channel_id AS "channelId", m.user_id AS "userId",
         m.message_text AS "messageText", m.file_url AS "fileUrl",
         m.file_name AS "fileName", m.created_at AS "createdAt",
         u.display_name AS "authorName", u.company_type AS "authorCompany"
  FROM messages m
  JOIN users u ON u.id = m.user_id
`;

messagesRouter.get("/channel/:channelId", async (req, res) => {
  const channelId = Number(req.params.channelId);
  const before = req.query.before ? Number(req.query.before) : null;
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const params = [channelId, limit];
  let where = "WHERE m.channel_id = $1";
  if (before) {
    params.push(before);
    where += ` AND m.id < $3`;
  }

  const result = await query(
    `${MESSAGE_SELECT} ${where} ORDER BY m.id DESC LIMIT $2`,
    params,
  );
  res.json({ messages: result.rows.reverse() });
});

messagesRouter.post("/", async (req, res) => {
  const { channelId, messageText, fileUrl, fileName } = req.body || {};
  const text = String(messageText || "").trim();
  if (!channelId || (!text && !fileUrl)) {
    return res.status(400).json({ error: "Порожнє повідомлення" });
  }

  const inserted = await query(
    `INSERT INTO messages (channel_id, user_id, message_text, file_url, file_name)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [Number(channelId), req.user.id, text, fileUrl || null, fileName || null],
  );

  const result = await query(`${MESSAGE_SELECT} WHERE m.id = $1`, [inserted.rows[0].id]);
  const message = result.rows[0];

  broadcast("message:new", message);
  res.status(201).json({ message });
});
