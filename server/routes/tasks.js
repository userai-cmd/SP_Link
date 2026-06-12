import { Router } from "express";
import { query } from "../db/pool.js";
import { authMiddleware } from "../auth.js";
import { broadcast } from "../ws.js";

export const tasksRouter = Router();

tasksRouter.use(authMiddleware);

const TASK_SELECT = `
  SELECT t.id, t.message_id AS "messageId", t.title, t.description,
         t.assigned_to AS "assignedTo", t.created_by AS "createdBy",
         t.status, t.deadline, t.created_at AS "createdAt", t.updated_at AS "updatedAt",
         a.display_name AS "assigneeName",
         c.display_name AS "creatorName",
         m.message_text AS "sourceMessageText"
  FROM tasks t
  LEFT JOIN users a ON a.id = t.assigned_to
  LEFT JOIN users c ON c.id = t.created_by
  LEFT JOIN messages m ON m.id = t.message_id
`;

const VALID_STATUSES = ["Todo", "In_Progress", "Done"];

tasksRouter.get("/", async (_req, res) => {
  const result = await query(`${TASK_SELECT} ORDER BY t.created_at DESC`);
  res.json({ tasks: result.rows });
});

tasksRouter.post("/", async (req, res) => {
  const { messageId, title, description, assignedTo, deadline } = req.body || {};
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) return res.status(400).json({ error: "Вкажіть назву задачі" });

  const inserted = await query(
    `INSERT INTO tasks (message_id, title, description, assigned_to, created_by, deadline)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      messageId ? Number(messageId) : null,
      cleanTitle,
      String(description || "").trim(),
      assignedTo ? Number(assignedTo) : null,
      req.user.id,
      deadline || null,
    ],
  );

  const result = await query(`${TASK_SELECT} WHERE t.id = $1`, [inserted.rows[0].id]);
  const task = result.rows[0];

  broadcast("task:new", task);
  res.status(201).json({ task });
});

tasksRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { title, description, assignedTo, status, deadline } = req.body || {};

  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: "Невірний статус" });
  }

  const updated = await query(
    `UPDATE tasks SET
       title       = COALESCE($2, title),
       description = COALESCE($3, description),
       assigned_to = CASE WHEN $4::text = 'clear' THEN NULL
                          WHEN $4::text IS NOT NULL THEN $4::integer
                          ELSE assigned_to END,
       status      = COALESCE($5, status),
       deadline    = CASE WHEN $6::text = 'clear' THEN NULL
                          WHEN $6::text IS NOT NULL THEN $6::timestamptz
                          ELSE deadline END,
       updated_at  = now()
     WHERE id = $1 RETURNING id`,
    [
      id,
      title != null ? String(title).trim() : null,
      description != null ? String(description).trim() : null,
      assignedTo === null ? "clear" : assignedTo != null ? String(assignedTo) : null,
      status || null,
      deadline === null ? "clear" : deadline != null ? String(deadline) : null,
    ],
  );
  if (updated.rowCount === 0) return res.status(404).json({ error: "Задачу не знайдено" });

  const result = await query(`${TASK_SELECT} WHERE t.id = $1`, [id]);
  const task = result.rows[0];

  broadcast("task:updated", task);
  res.json({ task });
});

tasksRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const result = await query("DELETE FROM tasks WHERE id = $1", [id]);
  if (result.rowCount === 0) return res.status(404).json({ error: "Задачу не знайдено" });

  broadcast("task:deleted", { id });
  res.json({ ok: true });
});
