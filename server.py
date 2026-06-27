#!/usr/bin/env python3
import argparse
import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
from datetime import datetime, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "jagd.sqlite"
PBKDF2_ROUNDS = 210_000
SESSIONS = {}
DB_LOCK = threading.Lock()


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id():
    return secrets.token_hex(12)


def hash_password(password, salt=None):
    raw_salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), raw_salt, PBKDF2_ROUNDS)
    return "pbkdf2_sha256${}${}${}".format(
        PBKDF2_ROUNDS,
        base64.b64encode(raw_salt).decode("ascii"),
        base64.b64encode(digest).decode("ascii"),
    )


def verify_password(password, stored):
    try:
        algo, rounds, salt_b64, digest_b64 = stored.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(digest_b64)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(rounds))
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def row_to_dict(row):
    return dict(row) if row else None


def get_db():
    DATA_DIR.mkdir(exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with DB_LOCK, get_db() as db:
        db.executescript(
            """
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
                typ TEXT NOT NULL DEFAULT '',
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
            """
        )


def ensure_settings(db, revier_id):
    row = db.execute("SELECT * FROM settings WHERE revier_id = ?", (revier_id,)).fetchone()
    if not row:
        stamp = now_iso()
        db.execute(
            """
            INSERT INTO settings (
                id, revier_id, show_self_location, show_standorte, show_kanzeln,
                show_abschuesse, show_archived, show_reviergrenze
            ) VALUES (?, ?, 1, 1, 1, 1, 0, 1)
            """,
            (new_id(), revier_id),
        )
        row = db.execute("SELECT * FROM settings WHERE revier_id = ?", (revier_id,)).fetchone()
    return row


def parse_body(handler):
    length = int(handler.headers.get("Content-Length", "0") or 0)
    if not length:
        return {}
    raw = handler.rfile.read(length)
    return json.loads(raw.decode("utf-8"))


def clean_text(value, default=""):
    if value is None:
        return default
    return str(value).strip()


def clean_status(value):
    return "archiviert" if value == "archiviert" else "aktiv"


def parse_float(value, name):
    try:
        return float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{name} fehlt")


def get_session_revier(handler):
    cookie = SimpleCookie(handler.headers.get("Cookie"))
    token = cookie.get("jagd_session")
    if not token:
        return None
    return SESSIONS.get(token.value)


class AppHandler(SimpleHTTPRequestHandler):
    server_version = "JagdApp/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def send_json(self, payload, status=HTTPStatus.OK, headers=None):
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(encoded)

    def send_error_json(self, message, status=HTTPStatus.BAD_REQUEST):
        self.send_json({"error": message}, status)

    def auth_revier_id(self):
        revier_id = get_session_revier(self)
        if not revier_id:
            self.send_error_json("Nicht angemeldet", HTTPStatus.UNAUTHORIZED)
            return None
        return revier_id

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/revier":
            self.handle_get_revier()
            return
        if path == "/api/map-data":
            self.handle_map_data()
            return
        if path.startswith("/api/"):
            self.send_error_json("Nicht gefunden", HTTPStatus.NOT_FOUND)
            return
        if path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/login":
            self.handle_login()
        elif path == "/api/logout":
            self.handle_logout()
        elif path == "/api/standorte":
            self.handle_create_standort()
        elif path == "/api/kanzeln":
            self.handle_create_kanzel()
        elif path == "/api/abschuesse":
            self.handle_create_abschuss()
        elif path == "/api/settings":
            self.handle_update_settings()
        else:
            self.send_error_json("Nicht gefunden", HTTPStatus.NOT_FOUND)

    def do_PATCH(self):
        path = urlparse(self.path).path
        parts = [p for p in path.split("/") if p]
        if len(parts) == 3 and parts[0] == "api" and parts[1] in {"standorte", "kanzeln", "abschuesse"}:
            self.handle_patch(parts[1], parts[2])
        else:
            self.send_error_json("Nicht gefunden", HTTPStatus.NOT_FOUND)

    def handle_login(self):
        try:
            body = parse_body(self)
            name = clean_text(body.get("name"))
            password = clean_text(body.get("passwort"))
            if not name or not password:
                self.send_error_json("Reviername und Passwort fehlen")
                return
            with DB_LOCK, get_db() as db:
                revier = db.execute("SELECT * FROM revier WHERE name = ?", (name,)).fetchone()
                if not revier:
                    if db.execute("SELECT COUNT(*) FROM revier").fetchone()[0] > 0:
                        self.send_error_json("Login falsch", HTTPStatus.UNAUTHORIZED)
                        return
                    stamp = now_iso()
                    revier_id = new_id()
                    db.execute(
                        "INSERT INTO revier (id, name, passwort_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                        (revier_id, name, hash_password(password), stamp, stamp),
                    )
                    ensure_settings(db, revier_id)
                else:
                    if not verify_password(password, revier["passwort_hash"]):
                        self.send_error_json("Login falsch", HTTPStatus.UNAUTHORIZED)
                        return
                    revier_id = revier["id"]
                    ensure_settings(db, revier_id)
            token = secrets.token_urlsafe(32)
            SESSIONS[token] = revier_id
            self.send_json(
                {"ok": True},
                headers={
                    "Set-Cookie": f"jagd_session={token}; Path=/; HttpOnly; SameSite=Lax"
                },
            )
        except Exception as exc:
            self.send_error_json(str(exc))

    def handle_logout(self):
        cookie = SimpleCookie(self.headers.get("Cookie"))
        token = cookie.get("jagd_session")
        if token:
            SESSIONS.pop(token.value, None)
        self.send_json({"ok": True}, headers={"Set-Cookie": "jagd_session=; Path=/; Max-Age=0"})

    def handle_get_revier(self):
        revier_id = self.auth_revier_id()
        if not revier_id:
            return
        with DB_LOCK, get_db() as db:
            revier = db.execute("SELECT id, name, reviergrenze FROM revier WHERE id = ?", (revier_id,)).fetchone()
            self.send_json({"revier": row_to_dict(revier)})

    def handle_map_data(self):
        revier_id = self.auth_revier_id()
        if not revier_id:
            return
        with DB_LOCK, get_db() as db:
            revier = db.execute("SELECT id, name, reviergrenze FROM revier WHERE id = ?", (revier_id,)).fetchone()
            settings = ensure_settings(db, revier_id)
            payload = {
                "revier": row_to_dict(revier),
                "settings": row_to_dict(settings),
                "standorte": [row_to_dict(r) for r in db.execute("SELECT * FROM standort WHERE revier_id = ? ORDER BY name", (revier_id,))],
                "kanzeln": [row_to_dict(r) for r in db.execute("SELECT * FROM kanzel WHERE revier_id = ? ORDER BY name", (revier_id,))],
                "abschuesse": [row_to_dict(r) for r in db.execute("SELECT * FROM abschuss WHERE revier_id = ? ORDER BY datum DESC, created_at DESC", (revier_id,))],
            }
            self.send_json(payload)

    def handle_create_standort(self):
        revier_id = self.auth_revier_id()
        if not revier_id:
            return
        try:
            body = parse_body(self)
            name = clean_text(body.get("name"))
            lat = parse_float(body.get("position_lat"), "Position")
            lng = parse_float(body.get("position_lng"), "Position")
            if not name:
                raise ValueError("Name fehlt")
            stamp = now_iso()
            item_id = new_id()
            with DB_LOCK, get_db() as db:
                db.execute(
                    """
                    INSERT INTO standort (id, revier_id, name, position_lat, position_lng, status, notiz, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (item_id, revier_id, name, lat, lng, clean_status(body.get("status")), clean_text(body.get("notiz")), stamp, stamp),
                )
            self.send_json({"id": item_id}, HTTPStatus.CREATED)
        except Exception as exc:
            self.send_error_json(str(exc))

    def handle_create_kanzel(self):
        revier_id = self.auth_revier_id()
        if not revier_id:
            return
        try:
            body = parse_body(self)
            name = clean_text(body.get("name"))
            typ = clean_text(body.get("typ"))
            standort_id = clean_text(body.get("standort_id"))
            if not name or not standort_id:
                raise ValueError("Name oder Standort fehlt")
            stamp = now_iso()
            item_id = new_id()
            with DB_LOCK, get_db() as db:
                if not db.execute("SELECT id FROM standort WHERE id = ? AND revier_id = ?", (standort_id, revier_id)).fetchone():
                    raise ValueError("Standort fehlt")
                db.execute(
                    """
                    INSERT INTO kanzel (id, revier_id, standort_id, name, typ, status, notiz, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (item_id, revier_id, standort_id, name, typ, clean_status(body.get("status")), clean_text(body.get("notiz")), stamp, stamp),
                )
            self.send_json({"id": item_id}, HTTPStatus.CREATED)
        except Exception as exc:
            self.send_error_json(str(exc))

    def handle_create_abschuss(self):
        revier_id = self.auth_revier_id()
        if not revier_id:
            return
        try:
            body = parse_body(self)
            wildart = clean_text(body.get("wildart"))
            schuetz_name = clean_text(body.get("schuetz_name"))
            datum = clean_text(body.get("datum"))
            lat = parse_float(body.get("position_lat"), "Position")
            lng = parse_float(body.get("position_lng"), "Position")
            if not wildart or not schuetz_name or not datum:
                raise ValueError("Pflichtfelder fehlen")
            standort_id = clean_text(body.get("standort_id")) or None
            kanzel_id = clean_text(body.get("kanzel_id")) or None
            stamp = now_iso()
            item_id = new_id()
            with DB_LOCK, get_db() as db:
                db.execute(
                    """
                    INSERT INTO abschuss (
                        id, revier_id, standort_id, kanzel_id, position_lat, position_lng,
                        datum, wildart, schuetz_name, status, notiz, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        item_id, revier_id, standort_id, kanzel_id, lat, lng, datum, wildart,
                        schuetz_name, clean_status(body.get("status")), clean_text(body.get("notiz")), stamp, stamp,
                    ),
                )
            self.send_json({"id": item_id}, HTTPStatus.CREATED)
        except Exception as exc:
            self.send_error_json(str(exc))

    def handle_update_settings(self):
        revier_id = self.auth_revier_id()
        if not revier_id:
            return
        body = parse_body(self)
        allowed = {
            "show_self_location",
            "show_standorte",
            "show_kanzeln",
            "show_abschuesse",
            "show_archived",
            "show_reviergrenze",
            "map_date_filter_from",
            "map_date_filter_to",
        }
        values = {}
        for key in allowed:
            if key in body:
                if key.startswith("show_"):
                    values[key] = 1 if body[key] else 0
                else:
                    values[key] = clean_text(body[key]) or None
        if not values:
            self.send_json({"ok": True})
            return
        assignments = ", ".join(f"{key} = ?" for key in values)
        with DB_LOCK, get_db() as db:
            ensure_settings(db, revier_id)
            db.execute(f"UPDATE settings SET {assignments} WHERE revier_id = ?", (*values.values(), revier_id))
        self.send_json({"ok": True})

    def handle_patch(self, table_name, item_id):
        revier_id = self.auth_revier_id()
        if not revier_id:
            return
        table = {"standorte": "standort", "kanzeln": "kanzel", "abschuesse": "abschuss"}[table_name]
        editable = {
            "standort": {"name", "position_lat", "position_lng", "status", "notiz"},
            "kanzel": {"standort_id", "name", "typ", "status", "notiz"},
            "abschuss": {"standort_id", "kanzel_id", "position_lat", "position_lng", "datum", "wildart", "schuetz_name", "status", "notiz"},
        }[table]
        body = parse_body(self)
        values = {}
        for key in editable:
            if key not in body:
                continue
            if key in {"position_lat", "position_lng"}:
                values[key] = parse_float(body[key], "Position")
            elif key == "status":
                values[key] = clean_status(body[key])
            elif key in {"standort_id", "kanzel_id"}:
                values[key] = clean_text(body[key]) or None
            else:
                values[key] = clean_text(body[key])
        if not values:
            self.send_json({"ok": True})
            return
        values["updated_at"] = now_iso()
        assignments = ", ".join(f"{key} = ?" for key in values)
        with DB_LOCK, get_db() as db:
            result = db.execute(
                f"UPDATE {table} SET {assignments} WHERE id = ? AND revier_id = ?",
                (*values.values(), item_id, revier_id),
            )
            if result.rowcount == 0:
                self.send_error_json("Nicht gefunden", HTTPStatus.NOT_FOUND)
                return
        self.send_json({"ok": True})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="10.66.66.1")
    parser.add_argument("--port", type=int, default=3067)
    args = parser.parse_args()
    init_db()
    server = ThreadingHTTPServer((args.host, args.port), AppHandler)
    print(f"Jagd-App läuft auf http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nBeendet")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
