/* Локальна PostgreSQL без системної інсталяції (для розробки).
   Запуск: npm run dev:db  →  DATABASE_URL=postgres://sp:sp@localhost:5433/sp_link */
import EmbeddedPostgres from "embedded-postgres";

const pg = new EmbeddedPostgres({
  databaseDir: "./.pgdata",
  user: "sp",
  password: "sp",
  port: 5433,
  persistent: true,
});

const exists = await import("node:fs").then((fs) => fs.existsSync("./.pgdata/PG_VERSION"));
if (!exists) {
  await pg.initialise();
}
await pg.start();
try {
  await pg.createDatabase("sp_link");
} catch {
  /* already exists */
}
console.log("PostgreSQL запущено: postgres://sp:sp@localhost:5433/sp_link");
console.log("Зупинити: Ctrl+C");

process.on("SIGINT", async () => {
  await pg.stop();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await pg.stop();
  process.exit(0);
});
