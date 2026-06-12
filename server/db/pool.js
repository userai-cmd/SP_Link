import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/sp_link";

export const pool = new Pool({
  connectionString,
  // Railway requires SSL for external connections; internal/local does not.
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
});

export async function query(text, params) {
  return pool.query(text, params);
}
