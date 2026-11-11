// Starts the isolated E2E backend: a throwaway Postgres in Docker, migrations, then
// Django on :8020. Never touches the shared Supabase database from backend/.env.
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const backend = join(root, "backend");
const python = [join(backend, ".venv", "Scripts", "python.exe"), join(backend, ".venv", "bin", "python")]
  .find(existsSync) || "python";

const DB_CONTAINER = "learnable-e2e-db";
const DB_PORT = process.env.E2E_DB_PORT || "5434";
const API_PORT = process.env.E2E_API_PORT || "8020";
const WEB_PORT = process.env.E2E_WEB_PORT || "8082";

const sh = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

function ensureDb() {
  let state = "";
  try { state = sh(`docker inspect -f "{{.State.Running}}" ${DB_CONTAINER}`); } catch { /* not created */ }
  if (state !== "true") {
    try { sh(`docker rm -f ${DB_CONTAINER}`); } catch { /* none */ }
    // tmpfs: data lives in memory and disappears with the container.
    sh(`docker run -d --name ${DB_CONTAINER} -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=learnable_e2e ` +
       `-p 127.0.0.1:${DB_PORT}:5432 --tmpfs /var/lib/postgresql/data postgres:16`);
  }
  for (let i = 0; i < 60; i++) {
    try { sh(`docker exec ${DB_CONTAINER} pg_isready -U postgres -d learnable_e2e`); return; } catch { /* starting */ }
    execSync(process.platform === "win32" ? "ping -n 2 127.0.0.1 > NUL" : "sleep 1");
  }
  throw new Error("E2E Postgres did not become ready");
}

const env = {
  ...process.env,
  DJANGO_DEBUG: "true",
  // Test users register through the API; skip the launch waitlist so they can use the app.
  WAITLIST_ENABLED: "false",
  DB_HOST: "127.0.0.1",
  DB_PORT,
  DB_NAME: "learnable_e2e",
  DB_USER: "postgres",
  DB_PASSWORD: "postgres",
  DB_SSLMODE: "",
  DB_TRANSACTION_POOLER: "false",
  CORS_EXTRA_ORIGINS: `http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT}`,
  FRONTEND_URL: `http://localhost:${WEB_PORT}`,
  PYTHONUNBUFFERED: "1",
};

ensureDb();
execSync(`"${python}" manage.py migrate --noinput`, { cwd: backend, env, stdio: "inherit" });
const server = spawn(python, ["manage.py", "runserver", `127.0.0.1:${API_PORT}`, "--noreload"],
  { cwd: backend, env, stdio: "inherit" });
const stop = () => server.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => process.exit(code ?? 0));
