/**
 * ORIVEXY NIGHTS desktop backend: embedded PostgreSQL + the Next.js standalone server.
 * Plain Node (no Electron APIs) so it can be tested on any OS:
 *   node backend.mjs <resourcesDir> <dataDir>
 */
import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

// Internal database name/user: kept from the previous product name so existing installs keep their data.
const DB_NAME = "nivex";
const PG_PACKAGE = `@embedded-postgres/${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
const DB_USER = "nivex";

/** "Noche-4k7p-Q2mx-9tzr": easy to read and type, 60+ bits of randomness. */
function readablePassword() {
  const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => abc[b % abc.length]);
  return `Noche-${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}`;
}

/** Can we listen on this port and host? (A missing IPv6 stack counts as free.) */
function canListen(port, host) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", (err) => resolve(err.code === "EADDRNOTAVAIL" || err.code === "EAFNOSUPPORT"));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

/**
 * First port free on every local address. Another app (e.g. a dev server)
 * may listen on 127.0.0.1 or ::1 only: binding 0.0.0.0 would still succeed
 * and "localhost" would then open that other app.
 */
async function freePort(start) {
  for (let port = start; port < start + 200; port++) {
    if ((await canListen(port, "0.0.0.0")) && (await canListen(port, "127.0.0.1")) && (await canListen(port, "::1"))) return port;
  }
  throw new Error("No hay ningún puerto libre para arrancar");
}

/** Local network addresses so phones on the same Wi-Fi can open the app. */
export function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254."))
    .map((i) => i.address);
}

async function waitForHttp(url, timeoutMs, isAlive, instanceId) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (!isAlive()) throw new Error("El servidor se ha detenido al arrancar (ver registro.log)");
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      // Our own server answers with this launch's id; anything else is another app on the port.
      if (res.ok && (await res.json().catch(() => null))?.instance === instanceId) return;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("El servidor tardó demasiado en arrancar");
}

/**
 * `pg_ctl start`: resolves when pg_ctl exits. Its output goes straight to the
 * log file, so no pipe is left open — on Windows the PostgreSQL server it
 * launches inherits pg_ctl's handles, and waiting for piped output to close
 * blocked every first launch until a 120 s timeout.
 */
function runPgCtlStart(file, args, logFile, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    const fd = openSync(logFile, "a");
    const child = spawn(file, args, { windowsHide: true, stdio: ["ignore", fd, fd] });
    closeSync(fd);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("pg_ctl no respondió a tiempo"));
    }, timeoutMs);
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`pg_ctl terminó con código ${code}`));
    });
  });
}

function run(file, args, logFile) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 120_000 }, (err, stdout, stderr) => {
      const out = `${stdout}${stderr}`.trim();
      if (out) appendFileSync(logFile, `[pg_ctl] ${out}\n`);
      if (err) reject(new Error(out || err.message));
      else resolve(out);
    });
  });
}

function tail(file, lines = 15) {
  try {
    return readFileSync(file, "utf8").trim().split(/\r?\n/).slice(-lines).join("\n");
  } catch {
    return "";
  }
}

/**
 * Applies pending Prisma migrations (shipped in resources/migrations) with
 * Prisma's own bookkeeping table, so the result is identical to
 * `prisma migrate deploy` and later upgrades just apply the new ones.
 */
async function applyMigrations(client, dir, log) {
  await client.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(36) PRIMARY KEY NOT NULL, "checksum" VARCHAR(64) NOT NULL, "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT, "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`);
  const done = new Set((await client.query(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)).rows.map((r) => r.migration_name));
  const names = readdirSync(dir).filter((n) => existsSync(path.join(dir, n, "migration.sql"))).sort();
  for (const name of names) {
    if (done.has(name)) continue;
    const sql = readFileSync(path.join(dir, name, "migration.sql"), "utf8");
    log(`Actualizando base de datos: ${name}`);
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES ($1, $2, now(), $3, now(), 1)`,
        [randomUUID(), createHash("sha256").update(sql).digest("hex"), name],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migración ${name}: ${err.message}`);
    }
  }
}

async function preparePostgres({ resourcesDir, dataDir, pgDir, pgPort, pg_ctl, databaseUrl, state, saveState, logFile, log, since }) {
  if (existsSync(pgDir) && !state.pgInitialized) {
    // Left over by an interrupted first run (unknown password): start over.
    log("Base de datos incompleta de un arranque anterior: recreándola");
    rmSync(pgDir, { recursive: true, force: true });
  }
  if (!existsSync(path.join(pgDir, "PG_VERSION"))) {
    log("Primera ejecución: creando base de datos…");
    const pgServer = new EmbeddedPostgres({
      databaseDir: pgDir,
      port: pgPort,
      user: DB_USER,
      password: state.dbPassword,
      persistent: true,
      // --no-sync: skip flushing the new cluster to disk (very slow on Windows).
      initdbFlags: ["--encoding=UTF8", "--locale=C", "--no-sync"],
      onLog: (m) => appendFileSync(logFile, `[pg] ${m}\n`),
      onError: (m) => appendFileSync(logFile, `[pg:err] ${m instanceof Error ? m.stack : m}\n`),
    });
    const t = Date.now();
    await pgServer.initialise();
    log(`initdb: ${Date.now() - t} ms`);
    state.pgInitialized = true;
    saveState();
  }
  // pg_ctl (not postgres.exe directly): on Windows it drops administrator
  // rights, which PostgreSQL refuses to run with, and waits until it is ready.
  const pgLog = path.join(dataDir, "postgres.log");
  if (existsSync(path.join(pgDir, "postmaster.pid"))) {
    log("PostgreSQL no se cerró bien la última vez: deteniéndolo");
    await run(pg_ctl, ["stop", "-D", pgDir, "-m", "fast", "-w"], logFile).catch(() => {});
  }
  log(`Arrancando PostgreSQL en el puerto ${pgPort}`);
  const tStart = Date.now();
  try {
    // synchronous_commit=off: commits don't wait for the disk (a crash can lose the last
    // second of changes, never corrupt data) — much snappier on a laptop.
    await runPgCtlStart(pg_ctl, ["start", "-D", pgDir, "-w", "-t", "90", "-l", pgLog, "-o", `-p ${pgPort} -c listen_addresses=localhost -c synchronous_commit=off`], logFile);
  } catch (err) {
    throw new Error(`PostgreSQL no pudo arrancar: ${err.message}\n${tail(pgLog)}`);
  }
  log(`PostgreSQL listo (${Date.now() - since} ms desde el inicio; pg_ctl start ${Date.now() - tStart} ms)`);

  const admin = new pg.Client({ connectionString: databaseUrl.replace(/\/[^/]+$/, "/postgres") });
  await admin.connect();
  const exists = (await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB_NAME])).rowCount > 0;
  if (!exists) await admin.query(`CREATE DATABASE ${DB_NAME}`);
  await admin.end();

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await applyMigrations(client, path.join(resourcesDir, "migrations"), log);
    // Base configuration (cities, categories, genres, discovery sources) — never content.
    // Idempotent: rows that already exist are left untouched.
    await client.query(readFileSync(path.join(resourcesDir, "base-data.sql"), "utf8"));
  } finally {
    await client.end();
  }
}

/**
 * API keys entered by the user (menu → "Claves de API…"). They live only in
 * this computer's data folder and reach the server as environment variables:
 * never in the browser, never in the repository.
 */
export const API_KEY_NAMES = ["TICKETMASTER_API_KEY", "GOOGLE_PLACES_API_KEY", "MAP_PROVIDER", "MAPTILER_KEY", "MAPBOX_TOKEN", "SMTP_URL", "EMAIL_FROM"];
const apiKeysFile = (dataDir) => path.join(dataDir, "api-keys.json");

export function readApiKeys(dataDir) {
  try {
    const raw = JSON.parse(readFileSync(apiKeysFile(dataDir), "utf8"));
    return Object.fromEntries(API_KEY_NAMES.filter((k) => typeof raw[k] === "string" && raw[k].trim()).map((k) => [k, raw[k].trim()]));
  } catch {
    return {};
  }
}

export function writeApiKeys(dataDir, values) {
  const clean = Object.fromEntries(API_KEY_NAMES.map((k) => [k, typeof values?.[k] === "string" ? values[k].trim().slice(0, 500) : ""]).filter(([, v]) => v));
  if (clean.MAP_PROVIDER && !["carto", "maptiler", "mapbox"].includes(clean.MAP_PROVIDER)) delete clean.MAP_PROVIDER;
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(apiKeysFile(dataDir), JSON.stringify(clean, null, 2), { mode: 0o600 });
  return clean;
}

function startServer({ resourcesDir, dataDir, nodeBinary, nodeEnv, port, databaseUrl, storageDir, cronSecret, admin, logFile, log }) {
  const appDir = path.join(resourcesDir, "server");
  const instanceId = randomUUID();
  const bin = (name) => {
    const p = path.join(resourcesDir, "bin", process.platform === "win32" ? `${name}.exe` : name);
    return existsSync(p) ? p : "";
  };
  const env = {
    ...process.env,
    ...nodeEnv,
    ...readApiKeys(dataDir),
    NODE_ENV: "production",
    // Node caches compiled JavaScript here: every launch after the first boots faster.
    NODE_COMPILE_CACHE: path.join(dataDir, "cache", "node-compile"),
    PORT: String(port),
    HOSTNAME: "0.0.0.0",
    APP_URL: `http://localhost:${port}`,
    DATABASE_URL: databaseUrl,
    STORAGE_DRIVER: "local",
    STORAGE_LOCAL_DIR: storageDir,
    FFMPEG_PATH: bin("ffmpeg"),
    CRON_SECRET: cronSecret,
    ADMIN_BOOTSTRAP_EMAIL: admin.email,
    ADMIN_BOOTSTRAP_PASSWORD: admin.password,
    ENABLE_INPROCESS_JOBS: "true",
    // Local single-user install: the first account created becomes its administrator.
    FIRST_USER_IS_ADMIN: "true",
    DESKTOP_APP: "true",
    // Public source responses recorded when the app was built (see scripts/record-snapshot.mts).
    DISCOVERY_SNAPSHOT_DIR: existsSync(path.join(resourcesDir, "snapshot")) ? path.join(resourcesDir, "snapshot") : "",
    EVENT_MODERATION: "off",
    RATE_LIMIT_SCALE: "20",
    NEXT_TELEMETRY_DISABLED: "1",
    APP_INSTANCE_ID: instanceId,
  };
  log(`Arrancando ORIVEXY NIGHTS en el puerto ${port}`);
  const child = spawn(nodeBinary, [path.join(appDir, "server.js")], { cwd: appDir, env, windowsHide: true });
  let alive = true;
  // The server's last output goes in the error message, so the dialog shows why it stopped.
  let recent = "";
  const keep = (d) => (recent = `${recent}${d}`.slice(-1200));
  child.stdout.on("data", (d) => (appendFileSync(logFile, `[app] ${d}`), keep(d)));
  child.stderr.on("data", (d) => (appendFileSync(logFile, `[app:err] ${d}`), keep(d)));
  child.on("exit", (code) => {
    alive = false;
    log(`Servidor detenido (código ${code})`);
  });
  // /api/health answers without touching the database.
  const ready = waitForHttp(`http://localhost:${port}/api/health`, 90_000, () => alive, instanceId).catch((err) => {
    throw new Error(recent.trim() ? `${err.message}\n\n${recent.trim()}` : err.message);
  });
  return { ready, alive: () => alive, kill: () => child.kill() };
}

/**
 * First launch: fill the empty database with the clubs and events bundled
 * with the app, so the map is full at once. Bounded wait: if it takes longer
 * the import finishes in the background.
 */
async function importSnapshot(url, cronSecret, log) {
  const started = Date.now();
  const request = fetch(`${url}/api/cron/snapshot-import`, { method: "POST", headers: { Authorization: `Bearer ${cronSecret}` } })
    .then(async (res) => {
      const body = await res.json().catch(() => ({}));
      log(`Datos iniciales (${res.status}) en ${Date.now() - started} ms: ${JSON.stringify(body.result ?? body)}`);
      return res.ok;
    })
    .catch((err) => (log(`Datos iniciales no importados: ${err.message}`), false));
  // Still running after a minute: it finishes in the background (count it as done).
  return Promise.race([request, new Promise((r) => setTimeout(() => r(true), 60_000))]);
}

/**
 * @param {{ resourcesDir: string, dataDir: string, nodeBinary: string, nodeEnv?: Record<string,string>, log?: (m: string) => void }} opts
 */
export async function startBackend(opts) {
  const t0 = Date.now();
  const { resourcesDir, dataDir, nodeBinary } = opts;
  mkdirSync(dataDir, { recursive: true });
  const logFile = path.join(dataDir, "registro.log");
  const log = (m) => {
    const line = `[${new Date().toISOString()}] ${m}\n`;
    appendFileSync(logFile, line);
    opts.log?.(m);
  };

  const stateFile = path.join(dataDir, "state.json");
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};
  state.dbPassword ??= randomBytes(18).toString("hex");
  state.cronSecret ??= randomBytes(24).toString("hex");
  // Administrator of this installation: generated here, kept only on this computer.
  state.admin ??= { email: "admin@orivexy.local", password: readablePassword() };
  const saveState = () => writeFileSync(stateFile, JSON.stringify(state, null, 2));
  saveState(); // before initdb: the cluster's password must never get lost

  // PostgreSQL and the Next.js server start in parallel: the server only
  // needs the database once the first page is requested.
  const [pgPort, port] = await Promise.all([freePort(54330), freePort(3000)]);
  const databaseUrl = `postgresql://${DB_USER}:${state.dbPassword}@localhost:${pgPort}/${DB_NAME}`;
  const storageDir = path.join(dataDir, "storage");
  const { pg_ctl } = await import(PG_PACKAGE);
  const pgDir = path.join(dataDir, "pgdata");
  const stopPostgres = () => run(pg_ctl, ["stop", "-D", pgDir, "-m", "fast", "-w"], logFile).catch(() => {});

  const server = startServer({ resourcesDir, dataDir, nodeBinary, nodeEnv: opts.nodeEnv, port, databaseUrl, storageDir, cronSecret: state.cronSecret, admin: state.admin, logFile, log });
  try {
    await Promise.all([
      preparePostgres({ resourcesDir, dataDir, pgDir, pgPort, pg_ctl, databaseUrl, state, saveState, logFile, log, since: t0 }),
      server.ready,
    ]);
  } catch (err) {
    server.kill();
    await stopPostgres();
    throw err;
  }
  const url = `http://localhost:${port}`;
  if (!state.adminCreated) {
    try {
      const res = await fetch(`${url}/api/cron/bootstrap-admin`, { method: "POST", headers: { Authorization: `Bearer ${state.cronSecret}` } });
      state.adminCreated = res.ok;
      log(`Administrador ${res.ok ? "listo" : `no creado (${res.status})`}: ${state.admin.email}`);
    } catch (err) {
      log(`Administrador no creado: ${err.message}`);
    }
  }
  if (!state.snapshotImported && existsSync(path.join(resourcesDir, "snapshot"))) {
    // A failed import is tried again on the next launch.
    state.snapshotImported = await importSnapshot(url, state.cronSecret, log);
  }
  saveState();
  log(`Listo en ${Date.now() - t0} ms: ${url}`);
  // Warm up the main sections in the background so the first clicks are instant.
  for (const p of ["/", "/map", "/events"]) fetch(`${url}${p}`).catch(() => {});

  return {
    url,
    port,
    admin: { ...state.admin, firstTime: !state.adminShown },
    /** The owner picks the admin password (kept only in this computer's state.json). */
    async setAdminPassword(password) {
      const res = await fetch(`${url}/api/desktop/admin-password`, {
        method: "POST",
        headers: { Authorization: `Bearer ${state.cronSecret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: body.error ?? `Error ${res.status}` };
      state.admin.password = password;
      state.adminCreated = true;
      saveState();
      this.admin.password = password;
      return { ok: true };
    },
    markAdminShown() {
      state.adminShown = true;
      saveState();
    },
    lanUrls: lanAddresses().map((ip) => `http://${ip}:${port}`),
    logFile,
    async stop() {
      if (server.alive()) {
        server.kill();
        await new Promise((r) => setTimeout(r, 800));
      }
      await stopPostgres();
    },
  };
}

// CLI for testing: node backend.mjs <resourcesDir> <dataDir>
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const [resourcesDir, dataDir] = process.argv.slice(2);
  const backend = await startBackend({ resourcesDir, dataDir, nodeBinary: process.execPath, log: console.log });
  console.log("URLs:", backend.url, backend.lanUrls.join(" "));
  const shutdown = async () => {
    await backend.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
