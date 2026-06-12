import { Router } from "express";
import bcrypt from "bcryptjs";
import { query } from "../db/pool.js";
import { signToken, authMiddleware } from "../auth.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Вкажіть email і пароль" });
  }

  const result = await query(
    "SELECT * FROM users WHERE email = $1 AND is_active = TRUE",
    [String(email).trim().toLowerCase()],
  );
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Невірний email або пароль" });
  }

  res.json({
    token: signToken(user),
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      companyType: user.company_type,
      role: user.role,
    },
  });
});

authRouter.get("/me", authMiddleware, (req, res) => {
  res.json({ user: req.user });
});
