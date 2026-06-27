import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "data");
const dbPath = path.join(dataDir, "jagdapp.sqlite");
const distDir = path.join(root, "frontend", "dist");
const host = process.env.HOST || "10.66.66.1";
const port = Number(process.env.PORT || 3067);

const app = express();
const sessions = new Map();

app.use(express.json({ limit: "256kb" }));
app.use(cookieParser());

fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function id() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "").trim();
}

function status(value) {
  return value === "archiviert" ? "archiviert" : "aktiv";
}

function number(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} fehlt`);
  return n;
}

function optional(value) {
  const v = text(value);
  return v || null;
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS revier (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      passwort_hash TEXT NOT NULL,
      reviergrenze TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS standort (
      id TEXT PRIMARY KEY,
      revier_id TEXT NOT NULL,
      name TEXT NOT NULL,
      position_lat REAL NOT NULL,
      position_lng REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'aktiv',
      notiz TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (revier_id) REFERENCES revier(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS kanzel (
      id TEXT PRIMARY KEY,
      revier_id TEXT NOT NULL,
      standort_id TEXT NOT NULL,
      name TEXT NOT NULL,
      typ TEXT,
      status TEXT NOT NULL DEFAULT 'aktiv',
      notiz TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (revier_id) REFERENCES revier(id) ON DELETE CASCADE,
      FOREIGN KEY (standort_id) REFERENCES standort(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS abschuss (
      id TEXT PRIMARY KEY,
      revier_id TEXT NOT NULL,
      standort_id TEXT,
      kanzel_id TEXT,
      position_lat REAL NOT NULL,
      position_lng REAL NOT NULL,
      datum TEXT NOT NULL,
      wildart TEXT NOT NULL,
      schuetz_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'aktiv',
      notiz TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (revier_id) REFERENCES revier(id) ON DELETE CASCADE,
      FOREIGN KEY (standort_id) REFERENCES standort(id) ON DELETE SET NULL,
      FOREIGN KEY (kanzel_id) REFERENCES kanzel(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      revier_id TEXT NOT NULL UNIQUE,
      show_self_location INTEGER NOT NULL DEFAULT 1,
      show_standorte INTEGER NOT NULL DEFAULT 1,
      show_kanzeln INTEGER NOT NULL DEFAULT 1,
      show_abschuesse INTEGER NOT NULL DEFAULT 1,
      show_archived INTEGER NOT NULL DEFAULT 0,
      show_reviergrenze INTEGER NOT NULL DEFAULT 1,
      map_date_filter_from TEXT,
      map_date_filter_to TEXT,
      FOREIGN KEY (revier_id) REFERENCES revier(id) ON DELETE CASCADE
    );
  `);
}

function verifyPassword(password, stored) {
  if (stored?.startsWith("$2")) return bcrypt.compareSync(password, stored);
  if (!stored?.startsWith("pbkdf2_sha256$")) return false;
  try {
    const [, rounds, salt64, hash64] = stored.split("$");
    const actual = crypto.pbkdf2Sync(password, Buffer.from(salt64, "base64"), Number(rounds), 32, "sha256");
    return crypto.timingSafeEqual(actual, Buffer.from(hash64, "base64"));
  } catch {
    return false;
  }
}

function ensureSettings(revierId) {
  const found = db.prepare("SELECT * FROM settings WHERE revier_id = ?").get(revierId);
  if (found) return found;
  db.prepare(`
    INSERT INTO settings (
      id, revier_id, show_self_location, show_standorte, show_kanzeln,
      show_abschuesse, show_archived, show_reviergrenze
    ) VALUES (?, ?, 1, 1, 1, 1, 0, 1)
  `).run(id(), revierId);
  return db.prepare("SELECT * FROM settings WHERE revier_id = ?").get(revierId);
}

function requireAuth(req, res, next) {
  const revierId = sessions.get(req.cookies.jagd_session);
  if (!revierId) return res.status(401).json({ error: "Nicht angemeldet" });
  req.revierId = revierId;
  next();
}

function apiError(res, error) {
  res.status(400).json({ error: error.message || "Fehler" });
}

migrate();

app.post("/api/login", (req, res) => {
  try {
    const name = text(req.body.name);
    const passwort = text(req.body.passwort);
    if (!name || !passwort) throw new Error("Reviername und Passwort fehlen");

    let revier = db.prepare("SELECT * FROM revier WHERE name = ?").get(name);
    if (!revier) {
      const count = db.prepare("SELECT COUNT(*) AS c FROM revier").get().c;
      if (count > 0) return res.status(401).json({ error: "Login falsch" });
      const stamp = now();
      const revierId = id();
      db.prepare("INSERT INTO revier (id, name, passwort_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(revierId, name, bcrypt.hashSync(passwort, 12), stamp, stamp);
      ensureSettings(revierId);
      revier = db.prepare("SELECT * FROM revier WHERE id = ?").get(revierId);
    } else if (!verifyPassword(passwort, revier.passwort_hash)) {
      return res.status(401).json({ error: "Login falsch" });
    }

    ensureSettings(revier.id);
    const token = crypto.randomBytes(32).toString("base64url");
    sessions.set(token, revier.id);
    res.cookie("jagd_session", token, { httpOnly: true, sameSite: "lax" });
    res.json({ ok: true });
  } catch (error) {
    apiError(res, error);
  }
});

app.post("/api/logout", (req, res) => {
  if (req.cookies.jagd_session) sessions.delete(req.cookies.jagd_session);
  res.clearCookie("jagd_session");
  res.json({ ok: true });
});

app.get("/api/revier", requireAuth, (req, res) => {
  const revier = db.prepare("SELECT id, name, reviergrenze FROM revier WHERE id = ?").get(req.revierId);
  res.json({ revier });
});

app.get("/api/map-data", requireAuth, (req, res) => {
  const revier = db.prepare("SELECT id, name, reviergrenze FROM revier WHERE id = ?").get(req.revierId);
  const settings = ensureSettings(req.revierId);
  res.json({
    revier,
    settings,
    standorte: db.prepare("SELECT * FROM standort WHERE revier_id = ? ORDER BY name").all(req.revierId),
    kanzeln: db.prepare("SELECT * FROM kanzel WHERE revier_id = ? ORDER BY name").all(req.revierId),
    abschuesse: db.prepare("SELECT * FROM abschuss WHERE revier_id = ? ORDER BY datum DESC, created_at DESC").all(req.revierId),
    schuetzen: db.prepare("SELECT DISTINCT schuetz_name FROM abschuss WHERE revier_id = ? AND schuetz_name != '' ORDER BY schuetz_name").all(req.revierId).map((r) => r.schuetz_name)
  });
});

app.post("/api/settings", requireAuth, (req, res) => {
  const allowed = [
    "show_self_location", "show_standorte", "show_kanzeln", "show_abschuesse",
    "show_archived", "show_reviergrenze", "map_date_filter_from", "map_date_filter_to"
  ];
  const values = {};
  for (const key of allowed) {
    if (!(key in req.body)) continue;
    values[key] = key.startsWith("show_") ? (req.body[key] ? 1 : 0) : optional(req.body[key]);
  }
  if (!Object.keys(values).length) return res.json({ ok: true });
  ensureSettings(req.revierId);
  const set = Object.keys(values).map((key) => `${key} = ?`).join(", ");
  db.prepare(`UPDATE settings SET ${set} WHERE revier_id = ?`).run(...Object.values(values), req.revierId);
  res.json({ ok: true });
});

app.post("/api/standorte", requireAuth, (req, res) => {
  try {
    const name = text(req.body.name);
    if (!name) throw new Error("Name fehlt");
    const stamp = now();
    const itemId = id();
    db.prepare(`
      INSERT INTO standort (id, revier_id, name, position_lat, position_lng, status, notiz, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      itemId, req.revierId, name,
      number(req.body.position_lat, "Position"), number(req.body.position_lng, "Position"),
      status(req.body.status), optional(req.body.notiz), stamp, stamp
    );
    res.status(201).json({ id: itemId });
  } catch (error) {
    apiError(res, error);
  }
});

app.post("/api/kanzeln", requireAuth, (req, res) => {
  try {
    const standortId = text(req.body.standort_id);
    const name = text(req.body.name);
    if (!standortId || !name) throw new Error("Standort oder Name fehlt");
    const standort = db.prepare("SELECT id FROM standort WHERE id = ? AND revier_id = ?").get(standortId, req.revierId);
    if (!standort) throw new Error("Standort fehlt");
    const stamp = now();
    const itemId = id();
    db.prepare(`
      INSERT INTO kanzel (id, revier_id, standort_id, name, typ, status, notiz, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(itemId, req.revierId, standortId, name, optional(req.body.typ), status(req.body.status), optional(req.body.notiz), stamp, stamp);
    res.status(201).json({ id: itemId });
  } catch (error) {
    apiError(res, error);
  }
});

app.post("/api/abschuesse", requireAuth, (req, res) => {
  try {
    const datum = text(req.body.datum);
    const wildart = text(req.body.wildart);
    const schuetz = text(req.body.schuetz_name);
    if (!datum || !wildart || !schuetz) throw new Error("Pflichtfelder fehlen");
    const stamp = now();
    const itemId = id();
    db.prepare(`
      INSERT INTO abschuss (
        id, revier_id, standort_id, kanzel_id, position_lat, position_lng,
        datum, wildart, schuetz_name, status, notiz, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      itemId, req.revierId, optional(req.body.standort_id), optional(req.body.kanzel_id),
      number(req.body.position_lat, "Position"), number(req.body.position_lng, "Position"),
      datum, wildart, schuetz, status(req.body.status), optional(req.body.notiz), stamp, stamp
    );
    res.status(201).json({ id: itemId });
  } catch (error) {
    apiError(res, error);
  }
});

function patch(table, allowed) {
  return (req, res) => {
    try {
      const values = {};
      for (const key of allowed) {
        if (!(key in req.body)) continue;
        if (key === "position_lat" || key === "position_lng") values[key] = number(req.body[key], "Position");
        else if (key === "status") values[key] = status(req.body[key]);
        else if (key.endsWith("_id") || key === "notiz" || key === "typ") values[key] = optional(req.body[key]);
        else values[key] = text(req.body[key]);
      }
      if (!Object.keys(values).length) return res.json({ ok: true });
      values.updated_at = now();
      const set = Object.keys(values).map((key) => `${key} = ?`).join(", ");
      const result = db.prepare(`UPDATE ${table} SET ${set} WHERE id = ? AND revier_id = ?`)
        .run(...Object.values(values), req.params.id, req.revierId);
      if (!result.changes) return res.status(404).json({ error: "Nicht gefunden" });
      res.json({ ok: true });
    } catch (error) {
      apiError(res, error);
    }
  };
}

function remove(table) {
  return (req, res) => {
    const result = db.prepare(`DELETE FROM ${table} WHERE id = ? AND revier_id = ?`).run(req.params.id, req.revierId);
    if (!result.changes) return res.status(404).json({ error: "Nicht gefunden" });
    res.json({ ok: true });
  };
}

app.patch("/api/standorte/:id", requireAuth, patch("standort", ["name", "position_lat", "position_lng", "status", "notiz"]));
app.patch("/api/kanzeln/:id", requireAuth, patch("kanzel", ["standort_id", "name", "typ", "status", "notiz"]));
app.patch("/api/abschuesse/:id", requireAuth, patch("abschuss", ["standort_id", "kanzel_id", "position_lat", "position_lng", "datum", "wildart", "schuetz_name", "status", "notiz"]));
app.delete("/api/kanzeln/:id", requireAuth, remove("kanzel"));
app.delete("/api/abschuesse/:id", requireAuth, remove("abschuss"));

app.use(express.static(distDir));
app.get("*", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

const server = app.listen(port, host, () => {
  console.log(`Jagd-App läuft auf http://${host}:${port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
