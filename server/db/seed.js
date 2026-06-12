import bcrypt from "bcryptjs";
import { pool } from "./pool.js";
import { migrate } from "./migrate.js";

const DEFAULT_CHANNELS = [
  { name: "загальний", legacy: "general", description: "Загальні питання SAT та Postex" },
  { name: "операції", legacy: "operations", description: "Операційні питання: відправлення, маршрути, склади" },
  { name: "спірні-питання", legacy: "disputes", description: "Спірні питання та претензії" },
];

export async function seed() {
  await migrate();

  for (const ch of DEFAULT_CHANNELS) {
    // Rename channels created by an older seed (English names).
    await pool.query("UPDATE channels SET name = $1 WHERE name = $2", [ch.name, ch.legacy]);
    await pool.query(
      `INSERT INTO channels (name, description)
       VALUES ($1, $2)
       ON CONFLICT (name) DO NOTHING`,
      [ch.name, ch.description],
    );
  }

  const adminEmail = process.env.ADMIN_EMAIL || "admin@sat.ua";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin12345";

  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [adminEmail]);
  if (existing.rowCount === 0) {
    const hash = await bcrypt.hash(adminPassword, 10);
    await pool.query(
      `INSERT INTO users (email, password_hash, display_name, company_type, role)
       VALUES ($1, $2, $3, 'SAT', 'admin')`,
      [adminEmail, hash, "Адміністратор"],
    );
    console.log(`Admin created: ${adminEmail} / ${adminPassword}`);
  } else {
    console.log(`Admin already exists: ${adminEmail}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => {
      console.log("Seed complete.");
      return pool.end();
    })
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
