import { Router } from "express";
import bcrypt from "bcryptjs";
import { query } from "../db/pool.js";
import { authMiddleware, adminOnly } from "../auth.js";

export const usersRouter = Router();

usersRouter.use(authMiddleware);

const PUBLIC_FIELDS =
  "id, email, display_name AS \"displayName\", company_type AS \"companyType\", role, is_active AS \"isActive\", created_at AS \"createdAt\"";

// All authenticated users can see the member list (needed for task assignment).
usersRouter.get("/", async (_req, res) => {
  const result = await query(
    `SELECT ${PUBLIC_FIELDS} FROM users ORDER BY display_name, email`,
  );
  res.json({ users: result.rows });
});

usersRouter.post("/", adminOnly, async (req, res) => {
  const { email, password, displayName, companyType, role } = req.body || {};
  if (!email || !password || !displayName || !companyType) {
    return res.status(400).json({ error: "Заповніть усі поля" });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: "Пароль має містити щонайменше 8 символів" });
  }
  if (!["SAT", "POSTEX"].includes(companyType)) {
    return res.status(400).json({ error: "Невірний тип компанії" });
  }

  const hash = await bcrypt.hash(password, 10);
  try {
    const result = await query(
      `INSERT INTO users (email, password_hash, display_name, company_type, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${PUBLIC_FIELDS}`,
      [
        String(email).trim().toLowerCase(),
        hash,
        String(displayName).trim(),
        companyType,
        role === "admin" ? "admin" : "user",
      ],
    );
    res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Користувач із таким email вже існує" });
    }
    throw err;
  }
});

usersRouter.patch("/:id", adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const { displayName, companyType, role, isActive } = req.body || {};

  if (id === req.user.id && isActive === false) {
    return res.status(400).json({ error: "Не можна деактивувати власний акаунт" });
  }

  const result = await query(
    `UPDATE users SET
       display_name = COALESCE($2, display_name),
       company_type = COALESCE($3, company_type),
       role         = COALESCE($4, role),
       is_active    = COALESCE($5, is_active)
     WHERE id = $1
     RETURNING ${PUBLIC_FIELDS}`,
    [
      id,
      displayName != null ? String(displayName).trim() : null,
      companyType && ["SAT", "POSTEX"].includes(companyType) ? companyType : null,
      role && ["admin", "user"].includes(role) ? role : null,
      typeof isActive === "boolean" ? isActive : null,
    ],
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "Користувача не знайдено" });
  res.json({ user: result.rows[0] });
});

usersRouter.post("/:id/reset-password", adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const { password } = req.body || {};
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: "Пароль має містити щонайменше 8 символів" });
  }
  const hash = await bcrypt.hash(password, 10);
  const result = await query("UPDATE users SET password_hash = $2 WHERE id = $1", [id, hash]);
  if (result.rowCount === 0) return res.status(404).json({ error: "Користувача не знайдено" });
  res.json({ ok: true });
});

usersRouter.delete("/:id", adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) {
    return res.status(400).json({ error: "Не можна видалити власний акаунт" });
  }
  const result = await query("DELETE FROM users WHERE id = $1", [id]);
  if (result.rowCount === 0) return res.status(404).json({ error: "Користувача не знайдено" });
  res.json({ ok: true });
});
