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
const dbPath = process.env.DB_PATH || path.join(dataDir, "jagdapp.sqlite");
const distDir = path.join(root, "frontend", "dist");
const host = process.env.HOST || "10.66.66.1";
const port = Number(process.env.PORT || 3067);
const sessions = new Map();

fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(cookieParser());

function id() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function clean(value) {
  return String(value ?? "").trim();
}

function optional(value) {
  const valueText = clean(value);
  return valueText || null;
}

function num(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} fehlt`);
  return parsed;
}

function optionalNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function itemStatus(value) {
  return value === "archiviert" ? "archiviert" : "aktiv";
}

function setupDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS revier (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      passwort_hash TEXT NOT NULL,
      reviergrenze TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kanzel (
      id TEXT PRIMARY KEY,
      revier_id TEXT NOT NULL,
      name TEXT NOT NULL,
      typ TEXT,
      position_lat REAL NOT NULL,
      position_lng REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'aktiv',
      notiz TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (revier_id) REFERENCES revier(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS abschuss (
      id TEXT PRIMARY KEY,
      revier_id TEXT NOT NULL,
      kanzel_id TEXT,
      position_lat REAL NOT NULL,
      position_lng REAL NOT NULL,
      schuss_lat REAL,
      schuss_lng REAL,
      schuss_kanzel_id TEXT,
      datum TEXT NOT NULL,
      wildart TEXT NOT NULL,
      geschlecht TEXT,
      schuetz_name TEXT NOT NULL,
      gewicht_kg REAL,
      status TEXT NOT NULL DEFAULT 'aktiv',
      notiz TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (revier_id) REFERENCES revier(id) ON DELETE CASCADE,
      FOREIGN KEY (kanzel_id) REFERENCES kanzel(id) ON DELETE SET NULL,
      FOREIGN KEY (schuss_kanzel_id) REFERENCES kanzel(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      revier_id TEXT NOT NULL UNIQUE,
      show_self_location INTEGER NOT NULL DEFAULT 1,
      show_kanzeln INTEGER NOT NULL DEFAULT 1,
      show_abschuesse INTEGER NOT NULL DEFAULT 1,
      show_archived INTEGER NOT NULL DEFAULT 0,
      show_reviergrenze INTEGER NOT NULL DEFAULT 1,
      map_date_filter_from TEXT,
      map_date_filter_to TEXT,
      FOREIGN KEY (revier_id) REFERENCES revier(id) ON DELETE CASCADE
    );
  `);
  ensureColumn("abschuss", "gewicht_kg", "REAL");
  ensureColumn("abschuss", "geschlecht", "TEXT");
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function ensureSettings(revierId) {
  const settings = db.prepare("SELECT * FROM settings WHERE revier_id = ?").get(revierId);
  if (settings) return settings;
  db.prepare(`
    INSERT INTO settings (
      id, revier_id, show_self_location, show_kanzeln,
      show_abschuesse, show_archived, show_reviergrenze
    ) VALUES (?, ?, 1, 1, 1, 0, 1)
  `).run(id(), revierId);
  return db.prepare("SELECT * FROM settings WHERE revier_id = ?").get(revierId);
}

function requireAuth(req, res, next) {
  const revierId = sessions.get(req.cookies.jagd_session);
  if (!revierId) return res.status(401).json({ error: "Nicht angemeldet" });
  req.revierId = revierId;
  next();
}

function fail(res, error) {
  res.status(400).json({ error: error.message || "Fehler" });
}

setupDb();

app.post("/api/login", (req, res) => {
  try {
    const name = clean(req.body.name);
    const passwort = clean(req.body.passwort);
    if (!name || !passwort) throw new Error("Login fehlt");

    let revier = db.prepare("SELECT * FROM revier WHERE name = ?").get(name);
    if (!revier) {
      const count = db.prepare("SELECT COUNT(*) AS count FROM revier").get().count;
      if (count > 0) return res.status(401).json({ error: "Login falsch" });
      const stamp = now();
      const revierId = id();
      db.prepare("INSERT INTO revier (id, name, passwort_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(revierId, name, bcrypt.hashSync(passwort, 12), stamp, stamp);
      ensureSettings(revierId);
      revier = db.prepare("SELECT * FROM revier WHERE id = ?").get(revierId);
    } else if (!bcrypt.compareSync(passwort, revier.passwort_hash)) {
      return res.status(401).json({ error: "Login falsch" });
    }

    const token = crypto.randomBytes(32).toString("base64url");
    sessions.set(token, revier.id);
    res.cookie("jagd_session", token, { httpOnly: true, sameSite: "lax" });
    res.json({ ok: true });
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/logout", (req, res) => {
  if (req.cookies.jagd_session) sessions.delete(req.cookies.jagd_session);
  res.clearCookie("jagd_session");
  res.json({ ok: true });
});

app.get("/api/revier", requireAuth, (req, res) => {
  res.json({
    revier: db.prepare("SELECT id, name, reviergrenze FROM revier WHERE id = ?").get(req.revierId),
  });
});

app.get("/api/map-data", requireAuth, (req, res) => {
  res.json({
    revier: db.prepare("SELECT id, name, reviergrenze FROM revier WHERE id = ?").get(req.revierId),
    settings: ensureSettings(req.revierId),
    kanzeln: db.prepare("SELECT * FROM kanzel WHERE revier_id = ? ORDER BY name").all(req.revierId),
    abschuesse: db.prepare("SELECT * FROM abschuss WHERE revier_id = ? ORDER BY datum DESC, created_at DESC").all(req.revierId),
    schuetzen: db.prepare("SELECT DISTINCT schuetz_name FROM abschuss WHERE revier_id = ? AND schuetz_name != '' ORDER BY schuetz_name").all(req.revierId).map((row) => row.schuetz_name),
  });
});

app.post("/api/settings", requireAuth, (req, res) => {
  const allowed = [
    "show_self_location",
    "show_kanzeln",
    "show_abschuesse",
    "show_archived",
    "show_reviergrenze",
    "map_date_filter_from",
    "map_date_filter_to",
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

app.post("/api/kanzeln", requireAuth, (req, res) => {
  try {
    const name = clean(req.body.name);
    if (!name) throw new Error("Name fehlt");
    const stamp = now();
    const itemId = id();
    db.prepare(`
      INSERT INTO kanzel (
        id, revier_id, name, typ, position_lat, position_lng,
        status, notiz, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      itemId,
      req.revierId,
      name,
      optional(req.body.typ),
      num(req.body.position_lat, "Position"),
      num(req.body.position_lng, "Position"),
      itemStatus(req.body.status),
      optional(req.body.notiz),
      stamp,
      stamp
    );
    res.status(201).json({ id: itemId });
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/abschuesse", requireAuth, (req, res) => {
  try {
    const datum = clean(req.body.datum);
    const wildart = clean(req.body.wildart);
    const schuetzName = clean(req.body.schuetz_name);
    if (!datum || !wildart || !schuetzName) throw new Error("Pflichtfelder fehlen");
    const stamp = now();
    const itemId = id();
    db.prepare(`
      INSERT INTO abschuss (
        id, revier_id, kanzel_id, position_lat, position_lng, schuss_lat,
        schuss_lng, schuss_kanzel_id, datum, wildart, geschlecht,
        schuetz_name, gewicht_kg, status, notiz, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      itemId,
      req.revierId,
      optional(req.body.kanzel_id),
      num(req.body.position_lat, "Position"),
      num(req.body.position_lng, "Position"),
      optionalNum(req.body.schuss_lat),
      optionalNum(req.body.schuss_lng),
      optional(req.body.schuss_kanzel_id),
      datum,
      wildart,
      optional(req.body.geschlecht),
      schuetzName,
      optionalNum(req.body.gewicht_kg),
      itemStatus(req.body.status),
      optional(req.body.notiz),
      stamp,
      stamp
    );
    res.status(201).json({ id: itemId });
  } catch (error) {
    fail(res, error);
  }
});

function patch(table, allowed) {
  return (req, res) => {
    try {
      const values = {};
      for (const key of allowed) {
        if (!(key in req.body)) continue;
        if (["position_lat", "position_lng", "schuss_lat", "schuss_lng", "gewicht_kg"].includes(key)) values[key] = optionalNum(req.body[key]);
        else if (key === "status") values[key] = itemStatus(req.body[key]);
        else if (key.endsWith("_id") || key === "typ" || key === "notiz") values[key] = optional(req.body[key]);
        else values[key] = clean(req.body[key]);
      }
      if (!Object.keys(values).length) return res.json({ ok: true });
      values.updated_at = now();
      const set = Object.keys(values).map((key) => `${key} = ?`).join(", ");
      const result = db.prepare(`UPDATE ${table} SET ${set} WHERE id = ? AND revier_id = ?`)
        .run(...Object.values(values), req.params.id, req.revierId);
      if (!result.changes) return res.status(404).json({ error: "Nicht gefunden" });
      res.json({ ok: true });
    } catch (error) {
      fail(res, error);
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

app.patch("/api/kanzeln/:id", requireAuth, patch("kanzel", ["name", "typ", "position_lat", "position_lng", "status", "notiz"]));
app.patch("/api/abschuesse/:id", requireAuth, patch("abschuss", ["kanzel_id", "position_lat", "position_lng", "schuss_lat", "schuss_lng", "schuss_kanzel_id", "datum", "wildart", "geschlecht", "schuetz_name", "gewicht_kg", "status", "notiz"]));
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
