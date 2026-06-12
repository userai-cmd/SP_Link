import jwt from "jsonwebtoken";
import "dotenv/config";

export const JWT_SECRET = process.env.JWT_SECRET || "sp-link-dev-secret-change-me";
const TOKEN_TTL = "7d";

export function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      companyType: user.company_type,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL },
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    return res.status(401).json({ error: "Необхідна авторизація" });
  }
  req.user = payload;
  next();
}

export function adminOnly(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Доступ лише для адміністратора" });
  }
  next();
}
