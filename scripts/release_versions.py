#!/usr/bin/env python3
"""Root-only, local release snapshots for the Jagd app."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import shutil
import stat
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

VERSION_RE = re.compile(r"^v\d{8}T\d{6}Z-[0-9a-f]{8}$")
RUNTIME_ASSETS = (Path("backend/server.js"), Path("frontend/dist"))


class ReleaseError(RuntimeError):
    pass


class ReleaseManager:
    def __init__(self, app_root=Path("/opt/jagdapp"), *, uid_getter=os.geteuid,
                 service_runner=None, health_checker=None, now=None):
        self.root = Path(app_root).resolve()
        self.versions = self.root / "data" / "versions"
        self.uid_getter = uid_getter
        self.service_runner = service_runner or self._systemctl
        self.health_checker = health_checker or self._health
        self.now = now or (lambda: datetime.now(timezone.utc))

    def require_root(self):
        if self.uid_getter() != 0:
            raise PermissionError("Dieser Befehl darf nur als root ausgeführt werden.")

    def _prepare_store(self):
        data_dir = self.root / "data"
        if data_dir.exists() and (data_dir.is_symlink() or data_dir.resolve() != data_dir):
            raise ReleaseError("Unsicheres Datenverzeichnis")
        if self.versions.is_symlink() or (self.versions.exists() and not self.versions.is_dir()):
            raise ReleaseError("Unsicheres Versionsverzeichnis")
        self.versions.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.versions.resolve() != self.versions:
            raise ReleaseError("Unsicheres Versionsverzeichnis")
        os.chmod(self.versions, 0o700)

    def _version_path(self, version_id):
        if not VERSION_RE.fullmatch(version_id or ""):
            raise ReleaseError("Ungültige Versions-ID")
        result = self.versions / version_id
        if result.parent != self.versions:
            raise ReleaseError("Versionspfad verlässt den Speicher")
        return result

    def _asset_source(self, rel):
        source = self.root / rel
        if source.is_symlink() or not source.exists():
            raise ReleaseError(f"Runtime-Asset fehlt oder ist ein Symlink: {rel}")
        if source.is_dir() and any(item.is_symlink() for item in source.rglob("*")):
            raise ReleaseError(f"Symlink im Runtime-Asset: {rel}")
        return source

    @staticmethod
    def _copy_private(source, destination):
        if source.is_dir():
            shutil.copytree(source, destination, symlinks=False)
            for base, dirs, files in os.walk(destination):
                os.chmod(base, 0o700)
                for name in files:
                    os.chmod(Path(base) / name, 0o600)
        else:
            destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            shutil.copy2(source, destination)
            os.chmod(destination, 0o600)

    @staticmethod
    def _asset_info(base, rel):
        target = base / rel
        files = [target] if target.is_file() else sorted(p for p in target.rglob("*") if p.is_file())
        result = []
        for file_path in files:
            if file_path.is_symlink():
                raise ReleaseError(f"Symlink im Runtime-Asset: {file_path}")
            digest = hashlib.sha256()
            with file_path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
            result.append({"path": file_path.relative_to(base).as_posix(), "size": file_path.stat().st_size,
                           "sha256": digest.hexdigest()})
        return {"path": rel.as_posix(), "type": "directory" if target.is_dir() else "file", "files": result,
                "total_bytes": sum(item["size"] for item in result)}

    def _git_commit(self):
        git_dir = self.root / ".main.git"
        if not git_dir.is_dir():
            return None
        try:
            return subprocess.run(
                ["git", f"--git-dir={git_dir}", f"--work-tree={self.root}", "rev-parse", "HEAD"],
                check=True, capture_output=True, text=True, timeout=10,
            ).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            return None

    def snapshot(self, reason="manual"):
        self.require_root()
        self._prepare_store()
        stamp = self.now().astimezone(timezone.utc)
        version_id = stamp.strftime("v%Y%m%dT%H%M%SZ-") + secrets.token_hex(4)
        final = self._version_path(version_id)
        staging = self.versions / (".snapshot-" + secrets.token_hex(8))
        try:
            staging.mkdir(mode=0o700)
            for rel in RUNTIME_ASSETS:
                self._copy_private(self._asset_source(rel), staging / "app" / rel)
            for directory in (staging / "app", staging / "app" / "backend", staging / "app" / "frontend"):
                if directory.exists():
                    os.chmod(directory, 0o700)
            metadata = {
                "version": version_id,
                "created_at": stamp.isoformat().replace("+00:00", "Z"),
                "git_commit": self._git_commit(),
                "reason": reason,
                "assets": [self._asset_info(staging / "app", rel) for rel in RUNTIME_ASSETS],
            }
            metadata_path = staging / "metadata.json"
            metadata_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            os.chmod(metadata_path, 0o600)
            os.rename(staging, final)
            return metadata
        except Exception:
            shutil.rmtree(staging, ignore_errors=True)
            raise

    def list(self):
        self.require_root()
        self._prepare_store()
        items = []
        for entry in sorted(self.versions.iterdir(), reverse=True):
            if entry.is_dir() and VERSION_RE.fullmatch(entry.name):
                try:
                    items.append(self._read_metadata(entry.name))
                except (OSError, ValueError, ReleaseError):
                    items.append({"version": entry.name, "error": "Metadaten unlesbar"})
        return items

    def _read_metadata(self, version_id):
        version_path = self._version_path(version_id)
        if version_path.is_symlink() or not version_path.is_dir():
            raise ReleaseError("Version nicht gefunden")
        metadata_path = version_path / "metadata.json"
        if metadata_path.is_symlink():
            raise ReleaseError("Unsichere Metadaten")
        data = json.loads(metadata_path.read_text(encoding="utf-8"))
        if data.get("version") != version_id:
            raise ReleaseError("Versions-Metadaten stimmen nicht überein")
        return data

    def _verify_snapshot(self, version_id, metadata):
        app_dir = self._version_path(version_id) / "app"
        expected_assets = {item.get("path"): item for item in metadata.get("assets", [])}
        for rel in RUNTIME_ASSETS:
            expected = expected_assets.get(rel.as_posix())
            if not expected or self._asset_info(app_dir, rel) != expected:
                raise ReleaseError(f"Prüfsummenfehler im Snapshot: {rel}")

    def show(self, version_id):
        self.require_root()
        self._prepare_store()
        return self._read_metadata(version_id)

    def _stage_asset(self, source, destination):
        destination.parent.mkdir(parents=True, exist_ok=True)
        stage = destination.parent / (f".{destination.name}.release-stage-{secrets.token_hex(6)}")
        self._copy_private(source, stage)
        if os.stat(stage).st_dev != os.stat(destination.parent).st_dev:
            raise ReleaseError("Staging und Ziel liegen nicht auf demselben Dateisystem")
        return stage

    def revert(self, version_id):
        self.require_root()
        self._prepare_store()
        metadata = self._read_metadata(version_id)
        self._verify_snapshot(version_id, metadata)
        selected = self._version_path(version_id) / "app"
        current = self.snapshot(reason=f"automatic-before-revert-to-{version_id}")
        swaps = []
        staged = []
        try:
            for rel in RUNTIME_ASSETS:
                source = selected / rel
                if source.is_symlink() or not source.exists():
                    raise ReleaseError(f"Snapshot unvollständig: {rel}")
                staged.append((rel, self._stage_asset(source, self.root / rel)))
            for rel, stage in staged:
                target = self.root / rel
                backup = target.parent / (f".{target.name}.release-old-{secrets.token_hex(6)}")
                os.rename(target, backup)
                try:
                    os.rename(stage, target)
                except Exception:
                    os.rename(backup, target)
                    raise
                swaps.append((target, backup))
            self.service_runner("restart")
            if not self.health_checker():
                raise ReleaseError("Healthcheck nach Neustart fehlgeschlagen")
        except Exception as error:
            for target, backup in reversed(swaps):
                failed = target.parent / (f".{target.name}.release-failed-{secrets.token_hex(6)}")
                if target.exists():
                    os.rename(target, failed)
                os.rename(backup, target)
                if failed.is_dir(): shutil.rmtree(failed, ignore_errors=True)
                elif failed.exists(): failed.unlink()
            for _rel, stage in staged:
                if stage.is_dir(): shutil.rmtree(stage, ignore_errors=True)
                elif stage.exists(): stage.unlink()
            try:
                self.service_runner("restart")
                self.health_checker()
            except Exception:
                pass
            raise ReleaseError(f"Revert fehlgeschlagen; vorherige App-Dateien wiederhergestellt: {error}") from error
        for _target, backup in swaps:
            if backup.is_dir(): shutil.rmtree(backup)
            else: backup.unlink()
        return {"restored": metadata, "safety_snapshot": current}

    @staticmethod
    def _systemctl(action):
        subprocess.run(["systemctl", action, "jagdapp"], check=True, timeout=60)

    @staticmethod
    def _health():
        for _ in range(20):
            try:
                with urllib.request.urlopen("http://127.0.0.1:3067/", timeout=2) as response:
                    if 200 <= response.status < 400:
                        return True
            except Exception:
                time.sleep(0.5)
        return False


def main(argv=None):
    parser = argparse.ArgumentParser(description="Root-only Jagd-App Releaseverwaltung")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list")
    show = sub.add_parser("show"); show.add_argument("version")
    sub.add_parser("snapshot")
    revert = sub.add_parser("revert"); revert.add_argument("version")
    args = parser.parse_args(argv)
    manager = ReleaseManager()
    try:
        if args.command == "list": result = manager.list()
        elif args.command == "show": result = manager.show(args.version)
        elif args.command == "snapshot": result = manager.snapshot()
        else: result = manager.revert(args.version)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0
    except (PermissionError, ReleaseError, OSError, subprocess.SubprocessError, ValueError) as error:
        print(f"Fehler: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
