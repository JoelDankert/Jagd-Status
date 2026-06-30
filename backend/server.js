import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "data");
const imageDir = path.join(dataDir, "images");
const dbPath = process.env.DB_PATH || path.join(dataDir, "jagdapp.sqlite");
const distDir = path.join(root, "frontend", "dist");
const host = process.env.HOST || "10.66.66.1";
const port = Number(process.env.PORT || 3067);
const sessions = new Map();
const BCRYPT_ROUNDS = 10;

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(imageDir, { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const app = express();
app.use(express.json({ limit: "8mb" }));
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

function decimalText(value) {
  const valueText = clean(value).replace(",", ".");
  return valueText || null;
}

function num(value, label) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(parsed)) throw new Error(`${label} fehlt`);
  return parsed;
}

function optionalNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function itemStatus(value) {
  return value === "archiviert" ? "archiviert" : "aktiv";
}

function saveImage(base64data, prefix) {
  if (!base64data) return null;
  if (base64data.startsWith("data:")) {
    const filename = `${prefix}_${crypto.randomBytes(8).toString("hex")}.jpg`;
    const raw = base64data.slice(base64data.indexOf(",") + 1);
    fs.writeFileSync(path.join(imageDir, filename), Buffer.from(raw, "base64"));
    return filename;
  }
  if (base64data.includes("/") || base64data.includes("\\")) return null;
  return base64data;
}

const IMAGE_FIELDS = ["bild_data", "bild2", "bild3"];

function deleteItemImages(item) {
  for (const field of IMAGE_FIELDS) {
    const val = item?.[field];
    if (!val || val.startsWith("data:")) continue;
    const p = path.join(imageDir, val);
    try { fs.unlinkSync(p); } catch {}
  }
}

function processImageFields(body, prefix) {
  for (const field of IMAGE_FIELDS) {
    if (field in body) body[field] = saveImage(body[field], prefix);
  }
}

function stripRowImages(row) {
  if (!row) return row;
  for (const field of IMAGE_FIELDS) {
    if (row[field] && row[field].startsWith("data:")) row[field] = null;
  }
  return row;
}

const mapDataCache = new Map();

function cacheKey(revierId) {
  const s = db.prepare("SELECT * FROM settings WHERE revier_id = ?").get(revierId);
  return revierId + "_" + JSON.stringify(s);
}

function getCachedMapData(revierId) {
  const key = cacheKey(revierId);
  const entry = mapDataCache.get(key);
  if (entry && entry.expires > Date.now()) return entry.data;
  return null;
}

function setCachedMapData(revierId, data) {
  const key = cacheKey(revierId);
  mapDataCache.set(key, { data, expires: Date.now() + 30000 });
  if (mapDataCache.size > 20) {
    const first = mapDataCache.keys().next().value;
    mapDataCache.delete(first);
  }
}

function invalidateCache(revierId) {
  for (const key of [...mapDataCache.keys()]) {
    if (key.startsWith(revierId)) mapDataCache.delete(key);
  }
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
    CREATE TABLE IF NOT EXISTS revier_request (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      passwort_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS revier_delete_request (
      id TEXT PRIMARY KEY,
      revier_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (revier_id) REFERENCES revier(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS kanzel (
      id TEXT PRIMARY KEY,
      revier_id TEXT NOT NULL,
      name TEXT NOT NULL,
      typ TEXT,
      position_lat REAL NOT NULL,
      position_lng REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'aktiv',
      bild_data TEXT,
      notiz TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (revier_id) REFERENCES revier(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS kamera (
      id TEXT PRIMARY KEY,
      revier_id TEXT NOT NULL,
      name TEXT NOT NULL,
      position_lat REAL NOT NULL,
      position_lng REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'aktiv',
      bild_data TEXT,
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
      uhrzeit TEXT,
      wildart TEXT NOT NULL,
      geschlecht TEXT,
      alter_text TEXT,
      schuetz_name TEXT NOT NULL,
      gewicht_kg REAL,
      wetter TEXT,
      wind TEXT,
      wind_richtung TEXT,
      wind_speed_kmh REAL,
      status TEXT NOT NULL DEFAULT 'aktiv',
      bild_data TEXT,
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
    CREATE TABLE IF NOT EXISTS aktivitaet (
      id TEXT PRIMARY KEY,
      revier_id TEXT NOT NULL,
      name TEXT NOT NULL,
      position_lat REAL NOT NULL,
      position_lng REAL NOT NULL,
      dauer_stunden REAL NOT NULL DEFAULT 0,
      richtung_grad REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (revier_id) REFERENCES revier(id) ON DELETE CASCADE
    );
  `);
  ensureColumn("abschuss", "gewicht_kg", "REAL");
  ensureColumn("abschuss", "geschlecht", "TEXT");
  ensureColumn("abschuss", "alter_text", "TEXT");
  ensureColumn("abschuss", "wetter", "TEXT");
  ensureColumn("abschuss", "wind", "TEXT");
  ensureColumn("abschuss", "uhrzeit", "TEXT");
  ensureColumn("abschuss", "wind_richtung", "TEXT");
  ensureColumn("abschuss", "wind_speed_kmh", "REAL");
  ensureColumn("abschuss", "bild_data", "TEXT");
  ensureColumn("abschuss", "bild2", "TEXT");
  ensureColumn("abschuss", "bild3", "TEXT");
  ensureColumn("kanzel", "bild_data", "TEXT");
  ensureColumn("kanzel", "bild2", "TEXT");
  ensureColumn("kanzel", "bild3", "TEXT");
  ensureColumn("kamera", "bild_data", "TEXT");
  ensureColumn("kamera", "bild2", "TEXT");
  ensureColumn("kamera", "bild3", "TEXT");
  ensureColumn("kamera", "typ", "TEXT");
  ensureColumn("settings", "show_kameras", "INTEGER DEFAULT 1");
  ensureColumn("revier", "viewer_passwort_hash", "TEXT");
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
      show_kameras, show_abschuesse, show_archived, show_reviergrenze
    ) VALUES (?, ?, 1, 1, 1, 1, 0, 1)
  `).run(id(), revierId);
  return db.prepare("SELECT * FROM settings WHERE revier_id = ?").get(revierId);
}

function requireAuth(req, res, next) {
  const session = sessions.get(req.cookies.jagd_session);
  if (!session) return res.status(401).json({ error: "Nicht angemeldet" });
  req.revierId = typeof session === "string" ? session : session.revierId;
  req.role = typeof session === "string" ? "admin" : session.role;
  next();
}

function requireAdmin(req, res, next) {
  if (req.role !== "admin") return res.status(403).json({ error: "Keine Berechtigung" });
  next();
}

function fail(res, error) {
  res.status(400).json({ error: error.message || "Fehler" });
}

setupDb();

const SYSTEM_ADMIN_PASSWORD = process.env.JAGDAPP_ADMIN_PASSWORD || "amogus";

function requireSystemAdmin(req, res) {
  if (clean(req.body?.passwort) !== SYSTEM_ADMIN_PASSWORD) {
    res.status(401).json({ error: "Admin-Passwort falsch" });
    return false;
  }
  return true;
}

function adminSnapshot() {
  return {
    requests: db.prepare("SELECT id, name, created_at FROM revier_request ORDER BY created_at DESC").all(),
    deleteRequests: db.prepare("SELECT id, revier_id, name, created_at FROM revier_delete_request ORDER BY created_at DESC").all(),
    reviere: db.prepare("SELECT id, name, created_at, updated_at FROM revier ORDER BY name").all(),
  };
}

function migrateImages() {
  const tables = ["kanzel", "kamera", "abschuss"];
  for (const table of tables) {
    const rows = db.prepare(`SELECT id, bild_data, bild2, bild3 FROM ${table}`).all();
    for (const row of rows) {
      let changed = false;
      const updates = {};
      for (const field of IMAGE_FIELDS) {
        if (row[field] && row[field].startsWith("data:")) {
          const filename = saveImage(row[field], `${table}_${row.id}_migrate`);
          if (filename) {
            updates[field] = filename;
            changed = true;
          }
        }
      }
      if (changed) {
        const set = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
        db.prepare(`UPDATE ${table} SET ${set} WHERE id = ?`).run(...Object.values(updates), row.id);
      }
    }
  }
  console.log("Bild-Migration abgeschlossen");
}
migrateImages();

app.post("/api/revier-requests", async (req, res) => {
  try {
    const name = clean(req.body.name);
    const passwort = clean(req.body.passwort);
    if (!name || !passwort) throw new Error("Reviername und Passwort fehlen");
    if (db.prepare("SELECT id FROM revier WHERE name = ?").get(name)) {
      return res.status(409).json({ error: "Account existiert bereits" });
    }

    const stamp = now();
    const passwortHash = await bcrypt.hash(passwort, BCRYPT_ROUNDS);
    const existing = db.prepare("SELECT id FROM revier_request WHERE name = ?").get(name);
    if (existing) {
      db.prepare("UPDATE revier_request SET passwort_hash = ?, created_at = ? WHERE id = ?").run(passwortHash, stamp, existing.id);
    } else {
      db.prepare("INSERT INTO revier_request (id, name, passwort_hash, created_at) VALUES (?, ?, ?, ?)")
        .run(id(), name, passwortHash, stamp);
    }
    res.status(201).json({ ok: true });
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/admin/data", (req, res) => {
  if (!requireSystemAdmin(req, res)) return;
  res.json(adminSnapshot());
});

app.post("/api/admin/requests/:id/approve", (req, res) => {
  try {
    if (!requireSystemAdmin(req, res)) return;
    const request = db.prepare("SELECT * FROM revier_request WHERE id = ?").get(req.params.id);
    if (!request) return res.status(404).json({ error: "Registrierung nicht gefunden" });
    if (db.prepare("SELECT id FROM revier WHERE name = ?").get(request.name)) {
      db.prepare("DELETE FROM revier_request WHERE id = ?").run(request.id);
      return res.status(409).json({ error: "Account existiert bereits" });
    }
    const stamp = now();
    const revierId = id();
    db.prepare("INSERT INTO revier (id, name, passwort_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(revierId, request.name, request.passwort_hash, stamp, stamp);
    ensureSettings(revierId);
    db.prepare("DELETE FROM revier_request WHERE id = ?").run(request.id);
    res.json(adminSnapshot());
  } catch (error) {
    fail(res, error);
  }
});

app.delete("/api/admin/requests/:id", (req, res) => {
  try {
    if (!requireSystemAdmin(req, res)) return;
    db.prepare("DELETE FROM revier_request WHERE id = ?").run(req.params.id);
    res.json(adminSnapshot());
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/admin/delete-requests/:id/approve", (req, res) => {
  try {
    if (!requireSystemAdmin(req, res)) return;
    const request = db.prepare("SELECT * FROM revier_delete_request WHERE id = ?").get(req.params.id);
    if (!request) return res.status(404).json({ error: "Löschanfrage nicht gefunden" });
    db.prepare("DELETE FROM revier_delete_request WHERE id = ?").run(request.id);
    db.prepare("DELETE FROM revier WHERE id = ?").run(request.revier_id);
    for (const [token, session] of sessions.entries()) {
      if (session.revierId === request.revier_id) sessions.delete(token);
    }
    res.json(adminSnapshot());
  } catch (error) {
    fail(res, error);
  }
});

app.delete("/api/admin/delete-requests/:id", (req, res) => {
  try {
    if (!requireSystemAdmin(req, res)) return;
    db.prepare("DELETE FROM revier_delete_request WHERE id = ?").run(req.params.id);
    res.json(adminSnapshot());
  } catch (error) {
    fail(res, error);
  }
});

app.delete("/api/admin/reviere/:id", (req, res) => {
  try {
    if (!requireSystemAdmin(req, res)) return;
    const revier = db.prepare("SELECT id FROM revier WHERE id = ?").get(req.params.id);
    if (!revier) return res.status(404).json({ error: "Gebiet nicht gefunden" });
    db.prepare("DELETE FROM revier_delete_request WHERE revier_id = ?").run(req.params.id);
    db.prepare("DELETE FROM revier WHERE id = ?").run(req.params.id);
    for (const [token, session] of sessions.entries()) {
      if (session.revierId === req.params.id) sessions.delete(token);
    }
    res.json(adminSnapshot());
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const name = clean(req.body.name);
    const passwort = clean(req.body.passwort);
    if (!name || !passwort) throw new Error("Login fehlt");
    const revier = db.prepare("SELECT * FROM revier WHERE name = ?").get(name);
    if (!revier) {
      return res.status(404).json({ error: "Account nicht vorhanden", code: "account_not_found" });
    }

    const [adminOk, viewerOk] = await Promise.all([
      bcrypt.compare(passwort, revier.passwort_hash),
      revier.viewer_passwort_hash ? bcrypt.compare(passwort, revier.viewer_passwort_hash) : Promise.resolve(false),
    ]);

    if (!adminOk && !viewerOk) {
      return res.status(401).json({ error: "Login falsch" });
    }

    const role = adminOk ? "admin" : "viewer";
    ensureSettings(revier.id);

    const token = crypto.randomBytes(32).toString("base64url");
    sessions.set(token, { revierId: revier.id, role });
    res.cookie("jagd_session", token, { httpOnly: true, sameSite: "lax", maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ ok: true, role });
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/logout", (req, res) => {
  if (req.cookies.jagd_session) sessions.delete(req.cookies.jagd_session);
  res.clearCookie("jagd_session");
  res.json({ ok: true });
});

app.get("/api/map-data", requireAuth, (req, res) => {
  const cached = getCachedMapData(req.revierId);
  if (cached) return res.json(cached);

  const nowMs = Date.now();
  const aktivitaetenAll = db.prepare("SELECT * FROM aktivitaet WHERE revier_id = ? ORDER BY created_at DESC").all(req.revierId);
  const aktivitaeten = [];
  const expired = [];
  for (const a of aktivitaetenAll) {
    const created = new Date(a.created_at).getTime();
    const durationMs = (Number(a.dauer_stunden) || 24) * 3600000;
    if (nowMs - created > durationMs) expired.push(a.id);
    else aktivitaeten.push(a);
  }
  for (const id of expired) db.prepare("DELETE FROM aktivitaet WHERE id = ?").run(id);

  const result = {
    revier: db.prepare("SELECT id, name, reviergrenze, viewer_passwort_hash IS NOT NULL AS has_viewer_passwort FROM revier WHERE id = ?").get(req.revierId),
    settings: ensureSettings(req.revierId),
    role: req.role,
    kanzeln: db.prepare("SELECT * FROM kanzel WHERE revier_id = ? ORDER BY name").all(req.revierId).map(stripRowImages),
    kameras: db.prepare("SELECT * FROM kamera WHERE revier_id = ? ORDER BY name").all(req.revierId).map(stripRowImages),
    abschuesse: db.prepare("SELECT * FROM abschuss WHERE revier_id = ? ORDER BY datum DESC, created_at DESC").all(req.revierId).map(stripRowImages),
    schuetzen: db.prepare("SELECT DISTINCT schuetz_name FROM abschuss WHERE revier_id = ? AND schuetz_name != '' ORDER BY schuetz_name").all(req.revierId).map((row) => row.schuetz_name),
    aktivitaeten,
  };

  setCachedMapData(req.revierId, result);
  res.json(result);
});

app.get("/api/images/:filename", (req, res) => {
  const filePath = path.join(imageDir, req.params.filename);
  if (!fs.existsSync(filePath) || !filePath.startsWith(imageDir)) return res.sendStatus(404);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.sendFile(filePath);
});

app.get("/api/revier", requireAuth, (req, res) => {
  res.json({
    revier: db.prepare("SELECT id, name, reviergrenze FROM revier WHERE id = ?").get(req.revierId),
  });
});

app.post("/api/revier/delete-request", requireAuth, requireAdmin, (req, res) => {
  try {
    const revier = db.prepare("SELECT id, name FROM revier WHERE id = ?").get(req.revierId);
    if (!revier) return res.status(404).json({ error: "Gebiet nicht gefunden" });
    const stamp = now();
    const existing = db.prepare("SELECT id FROM revier_delete_request WHERE revier_id = ?").get(req.revierId);
    if (existing) {
      db.prepare("UPDATE revier_delete_request SET name = ?, created_at = ? WHERE id = ?").run(revier.name, stamp, existing.id);
    } else {
      db.prepare("INSERT INTO revier_delete_request (id, revier_id, name, created_at) VALUES (?, ?, ?, ?)")
        .run(id(), req.revierId, revier.name, stamp);
    }
    res.status(201).json({ ok: true });
  } catch (error) {
    fail(res, error);
  }
});

app.patch("/api/revier", requireAuth, requireAdmin, async (req, res) => {
  try {
    const name = clean(req.body.name);
    if (!name) throw new Error("Name fehlt");
    const existing = db.prepare("SELECT id FROM revier WHERE name = ? AND id != ?").get(name, req.revierId);
    if (existing) throw new Error("Name bereits vergeben");
    const values = { name, updated_at: now() };
    const passwort = clean(req.body.passwort);
    if (passwort) values.passwort_hash = await bcrypt.hash(passwort, BCRYPT_ROUNDS);
    if ("viewer_passwort" in req.body) {
      values.viewer_passwort_hash = req.body.viewer_passwort ? await bcrypt.hash(clean(req.body.viewer_passwort), BCRYPT_ROUNDS) : null;
    }
    const set = Object.keys(values).map((k) => `${k} = ?`).join(", ");
    db.prepare(`UPDATE revier SET ${set} WHERE id = ?`).run(...Object.values(values), req.revierId);
    res.json({ ok: true });
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/settings", requireAuth, (req, res) => {
  const allowed = [
    "show_self_location",
    "show_kanzeln",
    "show_kameras",
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
  const set = Object.keys(values).map((key) => `${key} = ?`).join(", ");
  db.prepare(`UPDATE settings SET ${set} WHERE revier_id = ?`).run(...Object.values(values), req.revierId);
  invalidateCache(req.revierId);
  res.json({ ok: true });
});

function createHandler(table, extraFields = []) {
  return (req, res) => {
    try {
      const name = clean(req.body.name);
      if (!name && table !== "abschuss") throw new Error("Name fehlt");
      const lat = req.body.position_lat != null ? num(req.body.position_lat, "Position") : null;
      const lng = req.body.position_lng != null ? num(req.body.position_lng, "Position") : null;
      const stamp = now();
      const itemId = id();

      if (table === "abschuss") {
        const wildart = clean(req.body.wildart);
        if (!wildart) throw new Error("Wildart fehlt");
      }

      processImageFields(req.body, `${table}_${itemId}`);

      const fields = table === "kanzel" || table === "kamera"
        ? ["id", "revier_id", "name", "typ", "position_lat", "position_lng", "status",
           "bild_data", "bild2", "bild3", "notiz", "created_at", "updated_at"]
        : ["id", "revier_id", "kanzel_id", "position_lat", "position_lng", "schuss_lat", "schuss_lng",
           "schuss_kanzel_id", "datum", "uhrzeit", "wildart", "geschlecht", "alter_text",
           "schuetz_name", "gewicht_kg", "wetter", "wind", "bild_data", "bild2", "bild3",
           "status", "notiz", "created_at", "updated_at"];

      const values = fields.map((f) => {
        if (f === "id") return itemId;
        if (f === "revier_id") return req.revierId;
        if (f === "created_at" || f === "updated_at") return stamp;
        if (f === "status") return itemStatus(req.body.status);
        if (["position_lat", "position_lng", "schuss_lat", "schuss_lng", "gewicht_kg"].includes(f))
          return optionalNum(req.body[f]);
        if (f === "alter_text") return decimalText(req.body[f]);
        if (f === "datum") return clean(req.body.datum) || now().slice(0, 10);
        if (f === "uhrzeit") return table === "abschuss" ? clean(req.body.uhrzeit) : null;
        if (f === "wildart" && table === "abschuss") return clean(req.body.wildart);
        if (f === "schuetz_name" && table === "abschuss") return clean(req.body.schuetz_name);
        if (f === "kanzel_id" || f === "schuss_kanzel_id" || f === "typ" || f === "notiz")
          return optional(req.body[f]);
        if (IMAGE_FIELDS.includes(f)) return optional(req.body[f]);
        return clean(req.body[f]);
      });

      db.prepare(`INSERT INTO ${table} (${fields.join(", ")}) VALUES (${fields.map(() => "?").join(", ")})`)
        .run(...values);
      invalidateCache(req.revierId);
      res.status(201).json({ id: itemId });
    } catch (error) {
      fail(res, error);
    }
  };
}

function patchHandler(table, allowed) {
  return (req, res) => {
    try {
      const oldItem = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND revier_id = ?`)
        .get(req.params.id, req.revierId);
      if (!oldItem) return res.status(404).json({ error: "Nicht gefunden" });

      processImageFields(req.body, `${table}_${req.params.id}`);

      const values = {};
      for (const key of allowed) {
        if (!(key in req.body)) continue;
        const val = req.body[key];
        if (IMAGE_FIELDS.includes(key)) {
          if (val === "") {
            deleteItemImages({ [key]: oldItem[key] });
            values[key] = null;
          } else if (val && val !== oldItem[key]) {
            if (val.startsWith("data:")) {
              deleteItemImages({ [key]: oldItem[key] });
              values[key] = saveImage(val, `${table}_${req.params.id}`);
            }
          }
        } else if (["position_lat", "position_lng", "schuss_lat", "schuss_lng", "gewicht_kg"].includes(key)) {
          values[key] = optionalNum(val);
        } else if (key === "status") {
          values[key] = itemStatus(val);
        } else if (key === "alter_text") {
          values[key] = decimalText(val);
        } else if (key.endsWith("_id") || key === "typ" || key === "notiz") {
          values[key] = optional(val);
        } else {
          values[key] = clean(val);
        }
      }
      if (!Object.keys(values).length) return res.json({ ok: true });
      values.updated_at = now();
      const set = Object.keys(values).map((key) => `${key} = ?`).join(", ");
      const result = db.prepare(`UPDATE ${table} SET ${set} WHERE id = ? AND revier_id = ?`)
        .run(...Object.values(values), req.params.id, req.revierId);
      if (!result.changes) return res.status(404).json({ error: "Nicht gefunden" });
      invalidateCache(req.revierId);
      res.json({ ok: true });
    } catch (error) {
      fail(res, error);
    }
  };
}

function removeHandler(table) {
  return (req, res) => {
    const item = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND revier_id = ?`)
      .get(req.params.id, req.revierId);
    if (!item) return res.status(404).json({ error: "Nicht gefunden" });
    deleteItemImages(item);
    db.prepare(`DELETE FROM ${table} WHERE id = ? AND revier_id = ?`).run(req.params.id, req.revierId);
    invalidateCache(req.revierId);
    res.json({ ok: true });
  };
}

app.post("/api/kanzeln", requireAuth, requireAdmin, createHandler("kanzel"));
app.post("/api/kameras", requireAuth, requireAdmin, createHandler("kamera"));
app.post("/api/abschuesse", requireAuth, requireAdmin, createHandler("abschuss"));

app.patch("/api/kanzeln/:id", requireAuth, requireAdmin,
  patchHandler("kanzel", ["name", "typ", "position_lat", "position_lng", "status", "bild_data", "bild2", "bild3", "notiz"]));
app.patch("/api/kameras/:id", requireAuth, requireAdmin,
  patchHandler("kamera", ["name", "typ", "position_lat", "position_lng", "status", "bild_data", "bild2", "bild3", "notiz"]));
app.patch("/api/abschuesse/:id", requireAuth, requireAdmin,
  patchHandler("abschuss", ["kanzel_id", "position_lat", "position_lng", "schuss_lat", "schuss_lng",
    "schuss_kanzel_id", "datum", "uhrzeit", "wildart", "geschlecht", "alter_text", "schuetz_name",
    "gewicht_kg", "wetter", "wind", "bild_data", "bild2", "bild3", "status", "notiz"]));

app.delete("/api/kanzeln/:id", requireAuth, requireAdmin, removeHandler("kanzel"));
app.delete("/api/kameras/:id", requireAuth, requireAdmin, removeHandler("kamera"));
app.delete("/api/abschuesse/:id", requireAuth, requireAdmin, removeHandler("abschuss"));

app.post("/api/aktivitaeten", requireAuth, requireAdmin, (req, res) => {
  try {
    const name = clean(req.body.name);
    if (!name) throw new Error("Name fehlt");
    const lat = num(req.body.position_lat, "Position");
    const lng = num(req.body.position_lng, "Position");
    const dauer_stunden = Math.max(0.01, Math.min(720, Number(req.body.dauer_stunden) || 24));
    const richtung_grad = optionalNum(req.body.richtung_grad);
    const stamp = now();
    const itemId = id();
    db.prepare("INSERT INTO aktivitaet (id, revier_id, name, position_lat, position_lng, dauer_stunden, richtung_grad, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(itemId, req.revierId, name, lat, lng, dauer_stunden, richtung_grad, stamp, stamp);
    invalidateCache(req.revierId);
    res.status(201).json({ id: itemId });
  } catch (error) { fail(res, error); }
});

app.patch("/api/aktivitaeten/:id", requireAuth, requireAdmin, (req, res) => {
  try {
    const item = db.prepare("SELECT * FROM aktivitaet WHERE id = ? AND revier_id = ?").get(req.params.id, req.revierId);
    if (!item) return res.status(404).json({ error: "Nicht gefunden" });
    const set = {};
    const vals = [];
    for (const key of ["name", "dauer_stunden", "richtung_grad"]) {
      if (!(key in req.body)) continue;
      if (key === "richtung_grad") set.richtung_grad = optionalNum(req.body[key]);
      else if (key === "dauer_stunden") set.dauer_stunden = Math.max(0.01, Math.min(720, Number(req.body[key]) || 24));
      else set.name = clean(req.body[key]);
    }
    if (!Object.keys(set).length) return res.json({ ok: true });
    if ("dauer_stunden" in set) set.created_at = now();
    set.updated_at = now();
    const cols = Object.keys(set).map((k) => `${k} = ?`).join(", ");
    const result = db.prepare(`UPDATE aktivitaet SET ${cols} WHERE id = ? AND revier_id = ?`)
      .run(...Object.values(set), req.params.id, req.revierId);
    if (!result.changes) return res.status(404).json({ error: "Nicht gefunden" });
    invalidateCache(req.revierId);
    res.json({ ok: true });
  } catch (error) { fail(res, error); }
});

app.delete("/api/aktivitaeten/:id", requireAuth, requireAdmin, (req, res) => {
  const item = db.prepare("SELECT * FROM aktivitaet WHERE id = ? AND revier_id = ?").get(req.params.id, req.revierId);
  if (!item) return res.status(404).json({ error: "Nicht gefunden" });
  db.prepare("DELETE FROM aktivitaet WHERE id = ? AND revier_id = ?").run(req.params.id, req.revierId);
  invalidateCache(req.revierId);
  res.json({ ok: true });
});

app.use(express.static(distDir));
app.get("*", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

const SSL_DIR = "/etc/letsencrypt/live/revierverwaltung.duckdns.org";
let sslOptions = null;
try {
  sslOptions = {
    cert: fs.readFileSync(path.join(SSL_DIR, "fullchain.pem")),
    key: fs.readFileSync(path.join(SSL_DIR, "privkey.pem")),
  };
} catch {}

if (sslOptions) {
  const httpsServer = https.createServer(sslOptions, app);
  const redirectApp = express();
  redirectApp.use((req, res) => {
    res.redirect(301, `https://${req.hostname}${req.url}`);
  });

  httpsServer.listen(443, () => {
    console.log("HTTPS läuft auf Port 443");
  });
  http.createServer(redirectApp).listen(80, () => {
    console.log("HTTP→HTTPS Redirect auf Port 80");
  });
  app.listen(port, "0.0.0.0", () => {});
  const servers = [httpsServer];
  const shutdown = () => {
    httpsServer.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} else {
  const server = app.listen(port, host, () => {
    console.log(`Jagd-App läuft auf http://${host}:${port}`);
  });
  const shutdown = () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
